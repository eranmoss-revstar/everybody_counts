"""CloudFormation custom resource response helper."""

import json
import urllib.request

SUCCESS = "SUCCESS"
FAILED = "FAILED"


def send(event, context, response_status, response_data, physical_resource_id=None):
    body = json.dumps({
        "Status": response_status,
        "Reason": f"See CloudWatch log stream: {context.log_stream_name}",
        "PhysicalResourceId": physical_resource_id or context.log_stream_name,
        "StackId": event["StackId"],
        "RequestId": event["RequestId"],
        "LogicalResourceId": event["LogicalResourceId"],
        "Data": response_data,
    }).encode()

    req = urllib.request.Request(
        url=event["ResponseURL"],
        data=body,
        headers={"content-type": "", "content-length": str(len(body))},
        method="PUT",
    )
    urllib.request.urlopen(req, timeout=30)
