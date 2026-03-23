import axios from "axios";
import type { KrogerToken, KrogerStore, KrogerProduct, AisleLocation } from "./types.js";

const BASE_URL = "https://api.kroger.com/v1";

let cachedToken: KrogerToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("KROGER_CLIENT_ID and KROGER_CLIENT_SECRET must be set in environment");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await axios.post(
    `${BASE_URL}/connect/oauth2/token`,
    new URLSearchParams({
      grant_type: "client_credentials",
      scope: "product.compact",
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const { access_token, expires_in } = response.data as { access_token: string; expires_in: number };

  cachedToken = {
    accessToken: access_token,
    expiresAt: Date.now() + expires_in * 1000,
  };

  return cachedToken.accessToken;
}

export async function getStores(zipCode: string): Promise<KrogerStore[]> {
  const token = await getAccessToken();

  const response = await axios.get(`${BASE_URL}/locations`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      "filter.zipCode.near": zipCode,
      "filter.limit": 5,
    },
  });

  const data = response.data as { data: Array<{
    locationId: string;
    name: string;
    address: { addressLine1: string; city: string; state: string; zipCode: string };
  }> };

  return data.data.map((loc) => ({
    locationId: loc.locationId,
    name: loc.name,
    address: loc.address.addressLine1,
    city: loc.address.city,
    state: loc.address.state,
    zipCode: loc.address.zipCode,
  }));
}

export async function getProductAisle(
  item: string,
  locationId: string
): Promise<{ item: string; aisle: AisleLocation | null; matchedName: string | null }> {
  const token = await getAccessToken();

  try {
    const response = await axios.get(`${BASE_URL}/products`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        "filter.term": item,
        "filter.locationId": locationId,
        "filter.limit": 1,
      },
    });

    const data = response.data as { data: KrogerProduct[] };
    const product = data.data?.[0];

    if (!product) {
      return { item, aisle: null, matchedName: null };
    }

    return {
      item,
      aisle: product.aisleLocations?.[0] ?? null,
      matchedName: product.description,
    };
  } catch {
    return { item, aisle: null, matchedName: null };
  }
}
