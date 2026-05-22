# Backend Reference — Lambdas + CDK

This doc captures the backend a consumer repo would deploy to flip `react-frontend` from mock mode (`REACT_APP_AUTH_MODE=mock`) to real mode (`REACT_APP_AUTH_MODE=cognito`). It contains:

1. The six Python Lambda handlers that pair with the frontend's auth, upload, admin, and RAG query features
2. The CDK stack that provisions Cognito + API Gateway + S3 + DynamoDB + Bedrock Knowledge Base and wires everything together
3. Wire-up notes for each feature — what env vars to set, what stack outputs to feed back into the frontend, what IAM permissions are required

When any of this lands as a `@revstar/*` package (see `AmplifyGithub.md`), this doc stays as the canonical reference for what the package encapsulates.

---

## Feature-to-Lambda Map

| React feature | Frontend file | Backend endpoint | Lambda | Triggers / wiring |
|---|---|---|---|---|
| Login / sign-out | `AuthContext.tsx`, `LoginForm.tsx` | Cognito SDK (no API Gateway) | — | Cognito User Pool (frontend client, no secret) |
| Register → verify email | `RegisterForm.tsx`, `VerifyEmail.tsx` | Cognito SDK | `pre-signup`, `post-confirmation` | Cognito lifecycle triggers |
| Forgot password | `ForgotPassword.tsx` | Cognito SDK | — | Cognito built-in flow |
| Admin invite / list users | `AdminUserPanel.tsx` | `POST /admin/invite-user`, `GET /admin/users` | `admin` | API Gateway → Lambda (admin group required) |
| File upload | `UploadButton.tsx`, `VisibilityToggle.tsx`, `UploadProgress.tsx` | `POST /upload-url` | `upload` | Lambda returns pre-signed S3 PUT URL |
| Document ingestion | — (S3 side-effect) | — | `ingest` | S3 `OBJECT_CREATED_PUT` event on docs bucket |
| RAG query | `ChatInterface.tsx` | `POST /docs` | `query` | Bedrock Knowledge Base retrieve-and-generate |

---

## Shared Lambda dependencies

All Python Lambdas share one `requirements.txt`. The CDK bundling step copies it into each function's deployment package and runs `pip install` before zipping.

**`lambda/dependencies/requirements.txt`**
```
boto3>=1.28.0
botocore>=1.31.0
```

---

## 1. `pre-signup/index.py` — email domain validation

Rejects signups whose email domain isn't in the allowed list. Optionally auto-confirms for dev environments.

**Env vars**: `ALLOWED_EMAIL_DOMAINS` (JSON array like `["@clientdomain.com"]`), `AUTO_CONFIRM_USER` (`true`/`false`).

**Wiring**: attach as `preSignUp` trigger on the Cognito User Pool.

```python
import json
import os


def lambda_handler(event, context):
    """
    Cognito Pre-Signup trigger.
    Validates that the user's email domain is in the allowed list.
    Rejects signup if the domain is not permitted.
    """
    email = event['request']['userAttributes'].get('email', '')
    allowed_domains = json.loads(os.environ.get('ALLOWED_EMAIL_DOMAINS', '[]'))

    if not email:
        raise Exception("Email is required for registration.")

    domain_match = any(
        email.lower().endswith(domain.lower())
        for domain in allowed_domains
    )

    if not domain_match:
        domain_list = ', '.join(allowed_domains)
        raise Exception(
            f"Registration is restricted to the following email domains: {domain_list}"
        )

    auto_confirm = os.environ.get('AUTO_CONFIRM_USER', 'false').lower() == 'true'
    if auto_confirm:
        event['response']['autoConfirmUser'] = True
        event['response']['autoVerifyEmail'] = True

    return event
```

---

## 2. `post-confirmation/index.py` — default group + tenant mapping

After email verification: assign user to the default Cognito group, write a tenant/user record into DynamoDB, and derive a `tenant_id` from the email domain if the client didn't supply one.

**Env vars**: `USER_POOL_ID`, `TENANT_TABLE_NAME`, `DEFAULT_GROUP` (defaults to `viewer`).

**IAM**: `cognito-idp:AdminAddUserToGroup`, `cognito-idp:AdminUpdateUserAttributes` on the user pool ARN; write access to the tenant table.

**Wiring**: attach as `postConfirmation` trigger on the Cognito User Pool.

```python
import json
import os
import boto3
from datetime import datetime

cognito_client = boto3.client('cognito-idp')
dynamodb = boto3.resource('dynamodb')

USER_POOL_ID = os.environ.get('USER_POOL_ID')
TENANT_TABLE_NAME = os.environ.get('TENANT_TABLE_NAME')
DEFAULT_GROUP = os.environ.get('DEFAULT_GROUP', 'viewer')

tenant_table = dynamodb.Table(TENANT_TABLE_NAME) if TENANT_TABLE_NAME else None


def lambda_handler(event, context):
    """
    Cognito Post-Confirmation trigger.
    - Assigns the user to the default Cognito group (viewer).
    - Creates a tenant mapping entry in DynamoDB.
    - Derives tenant_id from email domain if not explicitly set.
    """
    username = event['userName']
    user_attributes = event['request']['userAttributes']
    email = user_attributes.get('email', '')
    tenant_id = user_attributes.get('custom:tenant_id', '')

    if not tenant_id and email:
        # "user@clientdomain.com" → "clientdomain"
        domain = email.split('@')[1] if '@' in email else ''
        tenant_id = domain.split('.')[0] if domain else 'default'

    try:
        cognito_client.admin_add_user_to_group(
            UserPoolId=USER_POOL_ID,
            Username=username,
            GroupName=DEFAULT_GROUP,
        )
        print(f"Added user {username} to group {DEFAULT_GROUP}")
    except Exception as e:
        print(f"Error adding user to group: {str(e)}")

    if tenant_table:
        try:
            tenant_table.put_item(
                Item={
                    'tenant_id': tenant_id,
                    'user_id': username,
                    'email': email,
                    'role': DEFAULT_GROUP,
                    'name': user_attributes.get('name', ''),
                    'department': user_attributes.get('custom:department', ''),
                    'created_at': datetime.utcnow().isoformat(),
                }
            )
            print(f"Created tenant mapping: {username} → {tenant_id}")
        except Exception as e:
            print(f"Error writing tenant mapping: {str(e)}")

    if not user_attributes.get('custom:tenant_id') and tenant_id:
        try:
            cognito_client.admin_update_user_attributes(
                UserPoolId=USER_POOL_ID,
                Username=username,
                UserAttributes=[
                    {'Name': 'custom:tenant_id', 'Value': tenant_id},
                ],
            )
        except Exception as e:
            print(f"Error updating tenant_id attribute: {str(e)}")

    return event
```

---

## 3. `admin/index.py` — invite and list users

Two endpoints, both gated on the caller being in the `admin` Cognito group:
- `POST /admin/invite-user` → create user via `AdminCreateUser`, Cognito emails a temporary password, user is added to a group and optionally mapped to a tenant.
- `GET /admin/users` → list all users with groups, status, tenant, created date (paginated).

**Env vars**: `USER_POOL_ID`, `TENANT_TABLE_NAME`.

**IAM**: `cognito-idp:AdminCreateUser`, `AdminAddUserToGroup`, `AdminGetUser`, `AdminListGroupsForUser`, `ListUsers` on the user pool ARN; read/write access to the tenant table.

**API Gateway**: wire both endpoints behind a `CognitoUserPoolsAuthorizer`. This Lambda does the admin-group check itself using JWT claims, so no extra scope required beyond authenticated access.

```python
import json
import os
import boto3
from datetime import datetime

cognito_client = boto3.client('cognito-idp')
dynamodb = boto3.resource('dynamodb')

USER_POOL_ID = os.environ.get('USER_POOL_ID')
TENANT_TABLE_NAME = os.environ.get('TENANT_TABLE_NAME')

tenant_table = dynamodb.Table(TENANT_TABLE_NAME) if TENANT_TABLE_NAME else None


def lambda_handler(event, context):
    """
    Admin user management Lambda.
    Routes based on resource path and HTTP method.
    All endpoints require the caller to be in the 'admin' Cognito group.
    """
    claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})
    groups = claims.get('cognito:groups', '')

    if 'admin' not in groups:
        return make_response(403, {'error': 'Admin access required'})

    resource = event.get('resource', '')
    method = event.get('httpMethod', '')

    if resource == '/admin/invite-user' and method == 'POST':
        return invite_user(json.loads(event.get('body', '{}')))
    elif resource == '/admin/users' and method == 'GET':
        return list_users()

    return make_response(404, {'error': 'Not found'})


def invite_user(body):
    email = body.get('email')
    if not email:
        return make_response(400, {'error': 'Email is required'})

    group = body.get('group', 'viewer')
    tenant_id = body.get('tenant_id', '')
    name = body.get('name', '')

    valid_groups = ['admin', 'analyst', 'viewer']
    if group not in valid_groups:
        return make_response(400, {'error': f'Invalid group. Must be one of: {", ".join(valid_groups)}'})

    try:
        user_attributes = [
            {'Name': 'email', 'Value': email},
            {'Name': 'email_verified', 'Value': 'true'},
        ]
        if name:
            user_attributes.append({'Name': 'name', 'Value': name})
        if tenant_id:
            user_attributes.append({'Name': 'custom:tenant_id', 'Value': tenant_id})

        response = cognito_client.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=email,
            UserAttributes=user_attributes,
            DesiredDeliveryMediums=['EMAIL'],
        )

        cognito_client.admin_add_user_to_group(
            UserPoolId=USER_POOL_ID,
            Username=email,
            GroupName=group,
        )

        if tenant_table and tenant_id:
            tenant_table.put_item(
                Item={
                    'tenant_id': tenant_id,
                    'user_id': email,
                    'email': email,
                    'role': group,
                    'name': name,
                    'invited_by': 'admin',
                    'created_at': datetime.utcnow().isoformat(),
                }
            )

        return make_response(200, {
            'message': f'User {email} invited successfully',
            'username': response['User']['Username'],
            'group': group,
            'tenant_id': tenant_id,
        })

    except cognito_client.exceptions.UsernameExistsException:
        return make_response(409, {'error': f'User {email} already exists'})
    except Exception as e:
        print(f"Error inviting user: {str(e)}")
        return make_response(500, {'error': 'Failed to invite user'})


def list_users():
    try:
        users = []
        params = {'UserPoolId': USER_POOL_ID, 'Limit': 60}

        while True:
            response = cognito_client.list_users(**params)

            for user in response['Users']:
                attrs = {a['Name']: a['Value'] for a in user.get('Attributes', [])}

                try:
                    groups_response = cognito_client.admin_list_groups_for_user(
                        UserPoolId=USER_POOL_ID,
                        Username=user['Username'],
                    )
                    user_groups = [g['GroupName'] for g in groups_response['Groups']]
                except Exception:
                    user_groups = []

                users.append({
                    'username': user['Username'],
                    'email': attrs.get('email', ''),
                    'name': attrs.get('name', ''),
                    'tenant_id': attrs.get('custom:tenant_id', ''),
                    'status': user['UserStatus'],
                    'groups': user_groups,
                    'created': user['UserCreateDate'].isoformat(),
                    'modified': user['UserLastModifiedDate'].isoformat(),
                    'enabled': user['Enabled'],
                })

            pagination_token = response.get('PaginationToken')
            if pagination_token:
                params['PaginationToken'] = pagination_token
            else:
                break

        return make_response(200, {
            'users': users,
            'count': len(users),
        })

    except Exception as e:
        print(f"Error listing users: {str(e)}")
        return make_response(500, {'error': 'Failed to list users'})


def make_response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
        },
        'body': json.dumps(body, default=str),
    }
```

---

## 4. `upload/index.py` — pre-signed S3 PUT URLs

The frontend posts `{ filename, contentType, tenantId, userId, visibility }`. The Lambda validates file type, builds a tenant-scoped S3 key, and returns a pre-signed URL + object tags (`tenant_id`, `user_id`, `visibility`). The browser uploads directly to S3.

**Key shape**:
- `shared` → `{tenant_id}/shared/{timestamp}_{filename}`
- `private` → `{tenant_id}/users/{user_id}/{timestamp}_{filename}`

**Env vars**: `DOCS_BUCKET_NAME`, `MAX_FILE_SIZE_MB` (default 50), `ALLOWED_FILE_TYPES` (comma-separated), `PRESIGN_EXPIRY_SECONDS` (default 300).

**IAM**: `s3:PutObject` + `s3:PutObjectTagging` on the docs bucket.

**API Gateway**: `POST /upload-url`, Cognito authorizer, scope `amplify-template-api/write`.

```python
import json
import os
import time
import boto3
import urllib.parse

s3_client = boto3.client('s3')

BUCKET_NAME = os.environ.get('DOCS_BUCKET_NAME')
MAX_FILE_SIZE_MB = int(os.environ.get('MAX_FILE_SIZE_MB', '50'))
ALLOWED_FILE_TYPES = os.environ.get('ALLOWED_FILE_TYPES', 'pdf,docx,doc,xlsx,xls,pptx,ppt,txt,csv,md,html,json,jpeg,jpg,png').split(',')
PRESIGN_EXPIRY_SECONDS = int(os.environ.get('PRESIGN_EXPIRY_SECONDS', '300'))


def lambda_handler(event, context):
    try:
        body = json.loads(event.get('body', '{}'))

        filename = body.get('filename', '').strip()
        content_type = body.get('contentType', 'application/octet-stream')
        tenant_id = body.get('tenantId', '').strip()
        user_id = body.get('userId', '').strip()
        visibility = body.get('visibility', 'shared')

        if not filename:
            return make_response(400, {'error': 'filename is required'})
        if not tenant_id:
            return make_response(400, {'error': 'tenantId is required'})
        if not user_id:
            return make_response(400, {'error': 'userId is required'})
        if visibility not in ('shared', 'private'):
            return make_response(400, {'error': 'visibility must be "shared" or "private"'})

        extension = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        if extension not in ALLOWED_FILE_TYPES:
            return make_response(400, {
                'error': f'File type .{extension} not allowed',
                'allowedTypes': ALLOWED_FILE_TYPES,
            })

        safe_filename = filename.replace('/', '_').replace('\\', '_')
        if len(safe_filename) > 200:
            safe_filename = safe_filename[-200:]

        timestamp = int(time.time())
        if visibility == 'private':
            key = f"{tenant_id}/users/{user_id}/{timestamp}_{safe_filename}"
        else:
            key = f"{tenant_id}/shared/{timestamp}_{safe_filename}"

        tags = urllib.parse.urlencode({
            'tenant_id': tenant_id,
            'user_id': user_id,
            'visibility': visibility,
        })

        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': BUCKET_NAME,
                'Key': key,
                'ContentType': content_type,
                'Tagging': tags,
            },
            ExpiresIn=PRESIGN_EXPIRY_SECONDS,
        )

        return make_response(200, {
            'uploadUrl': presigned_url,
            'key': key,
            'visibility': visibility,
            'expiresIn': PRESIGN_EXPIRY_SECONDS,
            'maxSizeMb': MAX_FILE_SIZE_MB,
        })

    except json.JSONDecodeError:
        return make_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"Error generating upload URL: {str(e)}")
        return make_response(500, {'error': 'Failed to generate upload URL'})


def make_response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
        },
        'body': json.dumps(body),
    }
```

---

## 5. `ingest/index.py` — S3 → Bedrock KB metadata + ingestion

Triggered by `OBJECT_CREATED_PUT` on the docs bucket. For each upload:
1. Parse `visibility` and `owner` from the S3 key path.
2. Write a `.metadata.json` sidecar next to the object — Bedrock KB reads this for per-document metadata filtering.
3. Start a KB ingestion job.

Sidecar files are skipped on re-invocation to prevent loops.

**Env vars**: `KNOWLEDGE_BASE_ID`, `DATA_SOURCE_ID`.

**IAM**: `bedrock:StartIngestionJob` on KB + docs bucket ARN; `s3:PutObject` on docs bucket (for sidecar).

**Wiring**: S3 event source, 15-min timeout.

```python
import json
import os
import boto3
from datetime import datetime

bedrock_agent = boto3.client('bedrock-agent')
s3_client = boto3.client('s3')

KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID')
DATA_SOURCE_ID = os.environ.get('DATA_SOURCE_ID')


def datetime_converter(o):
    if isinstance(o, datetime):
        return o.isoformat()
    raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")


def lambda_handler(event, context):
    """
    S3 PUT event trigger.
    1. Parses visibility and owner from the S3 key path
    2. Creates a .metadata.json sidecar file for Bedrock KB metadata filtering
    3. Starts a Knowledge Base ingestion job
    """
    try:
        record = event['Records'][0]
        bucket = record['s3']['bucket']['name']
        key = record['s3']['object']['key']

        if key.endswith('.metadata.json'):
            print(f"Skipping metadata file: {key}")
            return {'statusCode': 200, 'body': 'Skipped metadata file'}

        visibility, owner = parse_key_metadata(key)
        print(f"Processing: {key} → visibility={visibility}, owner={owner}")

        metadata = {
            'metadataAttributes': {
                'visibility': visibility,
                'owner': owner,
            }
        }

        metadata_key = f"{key}.metadata.json"
        s3_client.put_object(
            Bucket=bucket,
            Key=metadata_key,
            Body=json.dumps(metadata),
            ContentType='application/json',
        )
        print(f"Created metadata sidecar: {metadata_key}")

        input_params = {
            'knowledgeBaseId': KNOWLEDGE_BASE_ID,
            'dataSourceId': DATA_SOURCE_ID,
            'clientToken': context.aws_request_id,
        }

        response = bedrock_agent.start_ingestion_job(**input_params)
        ingestion_job = response.get('ingestionJob')

        print(f"Started ingestion job: {json.dumps(ingestion_job, default=datetime_converter)}")

        return {
            'statusCode': 200,
            'body': json.dumps({
                'key': key,
                'visibility': visibility,
                'owner': owner,
                'ingestionJob': ingestion_job,
            }, default=datetime_converter),
        }

    except Exception as e:
        print(f"Error processing upload: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)}),
        }


def parse_key_metadata(key):
    """
    Parse visibility and owner from S3 key path.

    Supported patterns:
      shared/{ts}_{file}                      → shared, ""
      users/{user_id}/{ts}_{file}             → private, user_id
      {tenant_id}/shared/{ts}_{file}          → shared, ""
      {tenant_id}/users/{user_id}/{ts}_{file} → private, user_id
    """
    parts = key.split('/')

    for i, part in enumerate(parts):
        if part == 'shared':
            return 'shared', ''
        if part == 'users' and i + 1 < len(parts):
            user_id = parts[i + 1]
            return 'private', user_id

    print(f"Warning: could not parse visibility from key '{key}', defaulting to shared")
    return 'shared', ''
```

---

## 6. `query/index.py` — RAG retrieve-and-generate with visibility filter

Takes a `question` from the frontend, runs Bedrock `retrieve_and_generate` against the Knowledge Base. Builds a metadata filter from the caller's JWT claims so users see shared docs + their own private docs; admins see everything. Falls back to direct model invocation if the KB call fails. Writes request + response to DynamoDB with a 30-day TTL.

**Env vars**: `KNOWLEDGE_BASE_ID`, `LOGGING_TABLE_NAME`.

**IAM**: `bedrock:RetrieveAndGenerate`, `bedrock:Retrieve`, `bedrock:InvokeModel` on `*`; write access to the logging table.

**API Gateway**: `POST /docs`, Cognito authorizer, scope `amplify-template-api/read`.

```python
import json
import os
import boto3
import uuid
import time
from datetime import datetime

bedrock_agent_runtime = boto3.client('bedrock-agent-runtime')
bedrock_runtime = boto3.client('bedrock-runtime')
dynamodb = boto3.resource('dynamodb')

KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID')
LOGGING_TABLE_NAME = os.environ.get('LOGGING_TABLE_NAME')

logging_table = dynamodb.Table(LOGGING_TABLE_NAME) if LOGGING_TABLE_NAME else None

DEFAULT_MODEL_ID = "us.anthropic.claude-3-7-sonnet-20250219-v1:0"


def lambda_handler(event, context):
    try:
        request_body = json.loads(event.get('body', '{}'))
        question = request_body.get('question', '')
        request_session_id = request_body.get('requestSessionId')
        model_id = request_body.get('modelId')

        if not question:
            return make_response(400, "Question parameter is required")

        claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})
        user_id = claims.get('sub', '')
        groups = claims.get('cognito:groups', '')
        is_admin = 'admin' in groups

        request_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()

        log_request(request_id, question, timestamp, user_id)

        effective_model_id = model_id if model_id else DEFAULT_MODEL_ID

        kb_config = {
            'knowledgeBaseId': KNOWLEDGE_BASE_ID,
            'modelArn': effective_model_id,
        }

        visibility_filter = build_visibility_filter(user_id, is_admin)
        if visibility_filter:
            kb_config['retrievalConfiguration'] = {
                'vectorSearchConfiguration': {
                    'filter': visibility_filter,
                }
            }

        input_params = {
            'input': {'text': question},
            'retrieveAndGenerateConfiguration': {
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': kb_config,
            }
        }

        if request_session_id:
            input_params['sessionId'] = request_session_id

        try:
            response = bedrock_agent_runtime.retrieve_and_generate(**input_params)

            citation_text = None
            session_id = response.get('sessionId')

            if response.get('citations') and len(response['citations']) > 0:
                location = response['citations'][0].get('retrievedReferences', [{}])[0].get('location', {})
                source_type = location.get('type')

                if source_type == 'S3':
                    citation_text = location.get('s3Location', {}).get('uri')
                elif source_type == 'WEB':
                    citation_text = location.get('webLocation', {}).get('url')

            result = {
                'response': response.get('output', {}).get('text', ''),
                'citation': citation_text,
                'sessionId': session_id,
            }

        except Exception as e:
            error_message = str(e)
            print(f"RAG query failed: {error_message}")

            try:
                fallback_model_id = model_id if model_id else DEFAULT_MODEL_ID

                request_body_fallback = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 1000,
                    "messages": [
                        {
                            "role": "user",
                            "content": f"Please answer this question as best you can: {question}"
                        }
                    ]
                }

                response = bedrock_runtime.invoke_model(
                    modelId=fallback_model_id,
                    body=json.dumps(request_body_fallback)
                )

                response_body = json.loads(response['body'].read())
                result = {
                    'response': response_body['content'][0]['text'],
                    'citation': None,
                    'sessionId': request_session_id,
                    'fallback_used': True,
                }

            except Exception as fallback_error:
                print(f"Fallback failed: {str(fallback_error)}")
                return make_response(500, "Unable to process your request. Please try again later.")

        log_response(request_id, result, timestamp)

        return {
            'statusCode': 200,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps(result),
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return make_response(500, "Server side error: please check function logs")


def build_visibility_filter(user_id, is_admin=False):
    """
    Build metadata filter for shared + user's private docs.
    Admins get no filter (see everything).
    """
    if is_admin or not user_id:
        return None

    return {
        'orAll': [
            {'equals': {'key': 'visibility', 'value': 'shared'}},
            {'andAll': [
                {'equals': {'key': 'visibility', 'value': 'private'}},
                {'equals': {'key': 'owner', 'value': user_id}},
            ]},
        ]
    }


def make_response(status_code, response_text, citation_text=None, session_id=None):
    return {
        'statusCode': status_code,
        'body': json.dumps({
            'response': response_text,
            'citation': citation_text,
            'sessionId': session_id,
        }),
        'headers': {'Access-Control-Allow-Origin': '*'},
    }


def log_request(request_id, query, timestamp, user_id=''):
    if not logging_table:
        return
    try:
        logging_table.put_item(
            Item={
                'id': request_id,
                'timestamp': timestamp,
                'requestType': 'query',
                'query': query,
                'user_id': user_id,
                'ttl': int(time.time()) + 30 * 24 * 60 * 60,
            }
        )
    except Exception as e:
        print(f"Error logging request: {str(e)}")


def log_response(request_id, result, timestamp):
    if not logging_table:
        return
    try:
        logging_table.update_item(
            Key={'id': request_id, 'timestamp': timestamp},
            UpdateExpression="set #resp = :r, #proc_time = :t",
            ExpressionAttributeNames={
                '#resp': 'response',
                '#proc_time': 'processing_time_ms',
            },
            ExpressionAttributeValues={
                ':r': json.dumps(result),
                ':t': int((datetime.utcnow() - datetime.fromisoformat(timestamp)).total_seconds() * 1000),
            }
        )
    except Exception as e:
        print(f"Error logging response: {str(e)}")
```

---

## 7. CDK stack — wires it all together

TypeScript CDK (`aws-cdk-lib` + `@cdklabs/generative-ai-cdk-constructs`). Single stack provisioning:

- **Storage**: S3 docs bucket (SSE-S3, enforce SSL, PUT/POST CORS for browser upload).
- **API**: API Gateway REST API with CORS + Cognito authorizer + usage plan (100 rps / 200 burst).
- **DynamoDB**: logging table (`id` + `timestamp`, with `requestType-index` GSI, PAY_PER_REQUEST, TTL attribute `ttl`); tenant config table (`tenant_id` + `user_id`).
- **Cognito**: User Pool (email sign-in, 8-char min password with upper/lower/digits, `tenant_id` + `department` custom attrs), three groups (`admin`/`analyst`/`viewer`), resource server with `read`/`write` scopes, M2M client (client credentials, has secret), frontend client (USER_PASSWORD + SRP, no secret), pre-signup + post-confirmation Lambda triggers.
- **Bedrock**: `VectorKnowledgeBase` with Titan embeddings (1024-d), S3 data source with fixed-size chunking (500 tokens, 20% overlap), fully managed OpenSearch Serverless vector store.
- **Lambdas**: all six Python functions above, Python 3.12 runtime. Bundling step copies the shared `requirements.txt` into each function's build directory and runs `pip install -r requirements.txt -t .`.
- **Routes**: `POST /admin/invite-user`, `GET /admin/users`, `POST /upload-url` (write scope), `POST /docs` (read scope).
- **Monitoring**: API Gateway log group (1-week retention) with a 5xx metric filter.

### Stack outputs (feed these into the frontend)

| CDK output | Frontend env var |
|---|---|
| `APIGatewayUrl` | `REACT_APP_API_URL` |
| `UserPoolId` | `REACT_APP_USER_POOL_ID` |
| `FrontendClientId` | `REACT_APP_USER_POOL_CLIENT_ID` |
| `DocsBucketName` | — (Lambda env var, not client-facing) |
| `KnowledgeBaseId` | — (Lambda env var) |
| `M2MClientId` / `M2MClientSecret` | — (server-to-server only) |

### CDK context (configured in `infra/cdk.json`)

```jsonc
{
  "context": {
    "allowedEmailDomains": ["@clientdomain.com"],
    "selfSignupEnabled": true,
    "maxUploadSizeMb": 50,
    "allowedUploadTypes": "pdf,docx,doc,xlsx,xls,pptx,ppt,txt,csv,md,html,json,jpeg,jpg,png"
  }
}
```

### Lambda bundling pattern — shared `requirements.txt`

```typescript
const lambdaConfig = {
  runtime: Runtime.PYTHON_3_12,
  handler: "index.lambda_handler",
  bundling: {
    commandHooks: {
      beforeBundling(inputDir: string, outputDir: string): string[] {
        return [];
      },
      afterBundling(inputDir: string, outputDir: string): string[] {
        return [
          `cp ${join(inputDir, '../dependencies/requirements.txt')} ${outputDir}`,
          `cd ${outputDir} && pip install -r requirements.txt -t .`,
        ];
      },
      beforeInstall() {
        return [];
      },
    },
  },
};
```

### Cognito User Pool + triggers

```typescript
const userPool = new cognito.UserPool(this, "BackendUserPool", {
  userPoolName: "amplify-template-user-pool",
  mfa: cognito.Mfa.OFF,
  selfSignUpEnabled: selfSignupEnabled,
  userVerification: {
    emailSubject: "Your verification code",
    emailBody: "Your verification code is {####}",
    emailStyle: cognito.VerificationEmailStyle.CODE,
  },
  signInAliases: { email: true },
  standardAttributes: {
    email: { required: true, mutable: true },
    fullname: { required: false, mutable: true },
  },
  customAttributes: {
    tenant_id: new cognito.StringAttribute({ mutable: true }),
    department: new cognito.StringAttribute({ mutable: true }),
  },
  passwordPolicy: {
    minLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireDigits: true,
    requireSymbols: false,
  },
  lambdaTriggers: {
    preSignUp: preSignUpLambda,
    postConfirmation: postConfirmationLambda,
  },
  removalPolicy: RemovalPolicy.DESTROY,
});

// Groups
new cognito.CfnUserPoolGroup(this, "AdminGroup",   { userPoolId: userPool.userPoolId, groupName: "admin",   description: "Administrators" });
new cognito.CfnUserPoolGroup(this, "AnalystGroup", { userPoolId: userPool.userPoolId, groupName: "analyst", description: "Analysts" });
new cognito.CfnUserPoolGroup(this, "ViewerGroup",  { userPoolId: userPool.userPoolId, groupName: "viewer",  description: "Read-only" });

// Resource server + scopes
const readScope  = new cognito.ResourceServerScope({ scopeName: "read",  scopeDescription: "Read access" });
const writeScope = new cognito.ResourceServerScope({ scopeName: "write", scopeDescription: "Write access" });
const resourceServer = userPool.addResourceServer("ResourceServer", {
  identifier: "amplify-template-api",
  userPoolResourceServerName: "Amplify Template API",
  scopes: [readScope, writeScope],
});

// Frontend client (browser login, no secret)
const frontendClient = userPool.addClient("FrontendClient", {
  userPoolClientName: "amplify-template-frontend-client",
  authFlows: { userPassword: true, userSrp: true },
  generateSecret: false,
});
```

### Bedrock Knowledge Base + S3 data source

```typescript
const knowledgeBase = new bedrock.VectorKnowledgeBase(this, "knowledgeBase", {
  embeddingsModel: bedrock.BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
});

const s3DataSource = new bedrock.S3DataSource(this, "s3DataSource", {
  bucket: docsBucket,
  knowledgeBase,
  dataSourceName: "docs",
  chunkingStrategy: bedrock.ChunkingStrategy.fixedSize({
    maxTokens: 500,
    overlapPercentage: 20,
  }),
});

// Trigger ingestion on every S3 PUT
lambdaIngestionJob.addEventSource(new S3EventSource(docsBucket, {
  events: [s3.EventType.OBJECT_CREATED_PUT],
}));
```

### API routes — authorizer + scopes

```typescript
const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, "BackendAuthorizer", {
  cognitoUserPools: [userPool],
});

// Admin (no scope — Lambda checks admin group from claims)
const adminResource = apiGateway.root.addResource("admin");
adminResource.addResource("invite-user").addMethod("POST", new apigw.LambdaIntegration(adminLambda), {
  authorizer, authorizationType: apigw.AuthorizationType.COGNITO,
});
adminResource.addResource("users").addMethod("GET", new apigw.LambdaIntegration(adminLambda), {
  authorizer, authorizationType: apigw.AuthorizationType.COGNITO,
});

// Upload — requires write scope
apiGateway.root.addResource("upload-url").addMethod("POST", new apigw.LambdaIntegration(uploadLambda), {
  authorizer, authorizationType: apigw.AuthorizationType.COGNITO,
  authorizationScopes: [`${resourceServer.userPoolResourceServerId}/write`],
});

// RAG query — requires read scope
apiGateway.root.addResource("docs").addMethod("POST", new apigw.LambdaIntegration(lambdaQuery), {
  authorizer, authorizationType: apigw.AuthorizationType.COGNITO,
  authorizationScopes: [`${resourceServer.userPoolResourceServerId}/read`],
});
```

---

## Flipping the frontend from mock → real

1. Deploy the stack: `cd infra && npm install && npx cdk deploy`.
2. Read CDK outputs (`APIGatewayUrl`, `UserPoolId`, `FrontendClientId`).
3. Set frontend env vars:

   ```bash
   REACT_APP_AUTH_MODE=cognito
   REACT_APP_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com/prod/
   REACT_APP_USER_POOL_ID=us-east-1_xxxxx
   REACT_APP_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
   REACT_APP_ALLOWED_EMAIL_DOMAINS=@clientdomain.com
   ```

4. Every service selector in `src/services/` reads `REACT_APP_AUTH_MODE` and routes to the real implementation. No component changes needed.

## Which pieces go into which `@revstar/*` package

See `AmplifyGithub.md` for the full package plan. The mapping:

| Package | Contents from this doc |
|---|---|
| `@revstar/cdk-auth` | Cognito User Pool + groups + resource server + M2M/frontend clients + `pre-signup` + `post-confirmation` + `admin` Lambdas + `/admin/*` routes |
| `@revstar/cdk-file-upload` | `upload` Lambda + `POST /upload-url` route + S3 bucket helpers + file-type/size validation |
| `@revstar/cdk-tenant-kb` | Bedrock `VectorKnowledgeBase` + S3 data source + `ingest` Lambda + `query` Lambda + `POST /docs` route + visibility metadata filter |
| `@revstar/react-auth` | `AuthContext`, `LoginForm`, `RegisterForm`, `VerifyEmail`, `ForgotPassword`, `AuthRouter`, `AdminUserPanel`, `cognito.ts`, `mockCognito.ts` |
| `@revstar/react-file-upload` | `UploadButton`, `UploadProgress`, `VisibilityToggle`, `upload.ts`, `mockUpload.ts` |
| `@revstar/shared-types` | `AuthUser`, `AuthMode`, `FileVisibility`, `UploadState`, `UploadUrlResponse`, `DocsRequest`, `DocsResponse` |
