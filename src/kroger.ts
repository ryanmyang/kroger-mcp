import axios from "axios";
import type { KrogerToken, KrogerStore, KrogerProduct, AisleLocation } from "./types.js";

const BASE_URL = "https://api.kroger.com/v1";

let cachedToken: KrogerToken | null = null;

function krogerError(context: string, err: unknown): Error {
  if (axios.isAxiosError(err) && err.response) {
    const body = JSON.stringify(err.response.data);
    console.error(`[kroger] ${context} → ${err.response.status}: ${body}`);
    return new Error(`Kroger API ${err.response.status} (${context}): ${body}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

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

  try {
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
  } catch (err) {
    throw krogerError("getAccessToken", err);
  }
}

export async function getStores(zipCode: string): Promise<KrogerStore[]> {
  const token = await getAccessToken();

  try {
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
  } catch (err) {
    throw krogerError("getStores", err);
  }
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
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      throw krogerError(`getProductAisle("${item}")`, err);
    }
    return { item, aisle: null, matchedName: null };
  }
}
