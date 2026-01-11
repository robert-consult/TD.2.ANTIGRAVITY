import axios from "axios";
const KEY = process.env.FORGE_KEY;
const ONE_DAY = 86400;

/**
 * Return yesterday's close for a 6-char pair like 'EURUSD'.
 */
export async function getPrevClose(rawPair) {
  const pair = rawPair.replace(/\W/g, "").toUpperCase().slice(0, 6); // EUR/USD -> EURUSD

  const url = `https://api.1forge.com/candles?symbol=${pair}&resolution=${ONE_DAY}&api_key=${KEY}`;
  console.log(`Fetching candle data for ${pair}...`);
  
  try {
    const { data } = await axios.get(url, { timeout: 5000 });

    if (!Array.isArray(data) || data.length < 2) {
      console.error(`1Forge candle array too short for ${pair}`);
      return null;
    }

    // API returns [timestamp, open, high, low, close]
    const yesterday = data[data.length - 2];
    const yesterdayClose = Number(yesterday[4]); // close
    console.log(`Previous close for ${pair}: ${yesterdayClose}`);
    return yesterdayClose;
  } catch (error) {
    console.error(`Error fetching candle data for ${pair}:`, error.message);
    return null;
  }
}