/**
 * TrustData Tracking Core - User Data Utilities
 * Shared between JS SDK and Shopify Pixel
 */

/**
 * SHA-256 hash a string using the Web Crypto API.
 * Normalizes to lowercase + trim before hashing (industry standard for PII).
 * @param {string} value
 * @returns {Promise<string>} Lowercase hex digest
 */
export async function hashSHA256(value) {
    const normalized = value.toLowerCase().trim();
    const encoded = new TextEncoder().encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Build user_data object in canonical TrustData format.
 * Accepts multiple input formats (plain object, Shopify customer/checkout, sGTM).
 *
 * Output:
 *   { email, phone, first_name, last_name, address: { street, city, region, postal_code, country } }
 *
 * @param {Object|null|undefined} data
 * @returns {Object|undefined}
 */
export function buildUserData(data) {
    if (!data) return undefined;

    const userData = {};

    if (data.email && typeof data.email === 'string') {
        userData.email = data.email;
    }

    if (data.phone && typeof data.phone === 'string') {
        userData.phone = data.phone;
    }

    // Address source — used for first/last name and address fields
    const addrSource = data.address || data.shippingAddress || data.billingAddress || data.defaultAddress;

    // first_name / last_name — top-level in user_data (also extracted from Shopify address sources)
    const firstName = data.first_name || data.firstName
        || addrSource?.first_name || addrSource?.firstName;
    if (firstName && typeof firstName === 'string') {
        userData.first_name = firstName;
    }

    const lastName = data.last_name || data.lastName
        || addrSource?.last_name || addrSource?.lastName;
    if (lastName && typeof lastName === 'string') {
        userData.last_name = lastName;
    }

    // Address object — street, city, region, postal_code, country
    if (addrSource && typeof addrSource === 'object') {
        const address = {};

        const street = addrSource.street || addrSource.address1;
        if (street && typeof street === 'string') address.street = street;

        if (addrSource.city && typeof addrSource.city === 'string') address.city = addrSource.city;

        const region = addrSource.region || addrSource.province || addrSource.provinceCode;
        if (region && typeof region === 'string') address.region = region;

        const postalCode = addrSource.postal_code || addrSource.zip;
        if (postalCode && typeof postalCode === 'string') address.postal_code = postalCode;

        const country = addrSource.country || addrSource.countryCode;
        if (country && typeof country === 'string') address.country = country;

        if (Object.keys(address).length) {
            userData.address = address;
        }
    }

    return Object.keys(userData).length ? userData : undefined;
}
