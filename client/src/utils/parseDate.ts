/* Converts various date formats to a Date object */
export default function parseDate(str: string | number) {
  if (!str) return null;
  
  try {
    // If it's a timestamp number (seconds since epoch)
    if (typeof str === 'number') {
      return new Date(str * 1000);
    }
    
    // If it's a string timestamp
    if (typeof str === 'string') {
      // Check if it's a numeric string (Unix timestamp)
      if (/^\d+$/.test(str)) {
        return new Date(parseInt(str) * 1000);
      }
      
      // Handle "YYYY-MM-DD HH:MM:SS" format
      if (str.includes(" ") && str.includes(":")) {
        return new Date(str.replace(" ", "T") + "Z");
      }
      
      // Try standard parsing for other formats
      const date = new Date(str);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
    
    // Fallback
    return null;
  } catch (error) {
    console.error("Error parsing date:", error);
    return null;
  }
}