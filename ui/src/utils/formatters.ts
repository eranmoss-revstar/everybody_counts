/**
 * Utility functions for formatting data in the UI
 * CRITICAL: Only format actual monetary values, not dates/months/counts
 */

/**
 * Format a number as currency with proper separators
 * ONLY for actual monetary values
 */
export const formatCurrency = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined) {
    return '$0.00';
  }
  
  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) {
    return '$0.00';
  }
  
  // Format large numbers in millions/billions
  if (Math.abs(num) >= 1e9) {
    return `$${(num / 1e9).toFixed(2)}B`;
  } else if (Math.abs(num) >= 1e6) {
    return `$${(num / 1e6).toFixed(2)}M`;
  } else if (Math.abs(num) >= 1e3) {
    return `$${(num / 1e3).toFixed(2)}K`;
  }
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
};

/**
 * Format a number with thousand separators
 */
export const formatNumber = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined) {
    return '0';
  }
  
  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) {
    return '0';
  }
  
  return new Intl.NumberFormat('en-US').format(num);
};

/**
 * Format percentage
 */
export const formatPercentage = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined) {
    return '0%';
  }
  
  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) {
    return '0%';
  }
  
  return `${num.toFixed(2)}%`;
};

/**
 * Format and enhance message content with proper number formatting
 * CRITICAL FIX: Don't apply currency formatting to everything
 */
export const formatMessageContent = (content: string): string => {
  // Don't format if it's already a formatted message
  if (!content || typeof content !== 'string') {
    return content || '';
  }
  
  // Only format actual JSON data, not narrative text
  try {
    // Check if content is pure JSON
    const parsed = JSON.parse(content);
    if (parsed) {
      return formatDataObject(parsed);
    }
  } catch (e) {
    // Not JSON - return as-is, don't try to format numbers in text
    // This prevents "$12.00 months" bug
  }
  
  return content;
};

/**
 * Format data object for display
 */
export const formatDataObject = (data: any): string => {
  if (Array.isArray(data)) {
    // Format array of objects as a table-like structure
    return data.map((item, index) => {
      const lines = Object.entries(item).map(([key, value]) => {
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const formattedValue = formatValue(key, value);
        return `${formattedKey}: ${formattedValue}`;
      });
      return `Record ${index + 1}:\n${lines.join('\n')}`;
    }).join('\n\n');
  } else if (typeof data === 'object' && data !== null) {
    // Format single object
    const lines = Object.entries(data).map(([key, value]) => {
      const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const formattedValue = formatValue(key, value);
      return `${formattedKey}: ${formattedValue}`;
    });
    return lines.join('\n');
  }
  
  return String(data);
};

/**
 * Format a value based on its key name
 * CRITICAL: Only format based on EXACT column names, not partial matches
 */
const formatValue = (key: string, value: any): string => {
  const keyLower = key.toLowerCase();
  
  if (value === null || value === undefined) {
    return 'N/A';
  }
  
  // EXACT column name matching to prevent over-formatting
  const CURRENCY_COLUMNS = [
    'total_revenue', 'total_cost', 'revenue', 'cost', 
    'amount', 'price', 'budget', 'sum'
  ];
  
  const PERCENTAGE_COLUMNS = [
    'utilization_rate', 'profit_margin', 'growth_rate', 
    'percentage', 'margin', 'rate'
  ];
  
  const DATE_COLUMNS = [
    'invoice_date', 'created_at', 'updated_at', 
    'month_start_date', 'date'
  ];
  
  const COUNT_COLUMNS = [
    'employee_count', 'row_count', 'quantity', 'count'
  ];
  
  // Check for EXACT matches only
  if (CURRENCY_COLUMNS.includes(keyLower)) {
    return formatCurrency(value);
  }
  
  if (PERCENTAGE_COLUMNS.includes(keyLower)) {
    return formatPercentage(value);
  }
  
  if (DATE_COLUMNS.includes(keyLower)) {
    return new Date(value).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
  
  if (COUNT_COLUMNS.includes(keyLower)) {
    return formatNumber(value);
  }
  
  // For month_year column, keep as-is (e.g., "Dec'24")
  if (keyLower === 'month_year' || keyLower === 'month') {
    return String(value);
  }
  
  // For customer names, keep as-is
  if (keyLower === 'fc_customer' || keyLower === 'customer' || 
      keyLower === 'customer_name' || keyLower === 'name') {
    return String(value);
  }
  
  // Default: return as string without formatting
  return String(value);
};