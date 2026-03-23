export interface KrogerToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp ms
}

export interface KrogerStore {
  locationId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface AisleLocation {
  bayNumber?: string;
  description?: string;
  number?: string;
  side?: string;
  shelfNumber?: string;
}

export interface KrogerProduct {
  productId: string;
  description: string;
  aisleLocations: AisleLocation[];
}

export interface AisleGroup {
  aisleNumber: string;
  aisleDescription: string;
  items: string[];
}
