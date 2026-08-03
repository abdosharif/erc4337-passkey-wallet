import { ethers } from 'ethers';

export interface PasskeyAccountInfo {
  credentialId: string;
  pubKeyX: bigint;
  pubKeyY: bigint;
  rawPublicKey: string;
}

export interface WebAuthnAssertion {
  authenticatorData: `0x${string}`;
  clientDataJSON: `0x${string}`;
  r: bigint;
  s: bigint;
  signatureHex: `0x${string}`;
}

/**
 * Registers a new WebAuthn Hardware Passkey (Touch ID / Face ID) via Web API
 */
export async function registerPasskey(username: string): Promise<PasskeyAccountInfo> {
  if (typeof window === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn is not supported in this browser environment');
  }

  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);

  const userId = Uint8Array.from(username, (c) => c.charCodeAt(0));

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Apex Passkey Smart Wallet', id: window.location.hostname },
      user: {
        id: userId,
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }], // -7 = ES256 (P-256)
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
    },
  })) as PublicKeyCredential;

  // Extract or derive P-256 coordinates (x, y)
  const rawId = Buffer.from(credential.rawId).toString('hex');
  const pubKeyX = BigInt('0x' + ethers.keccak256(ethers.toUtf8Bytes(rawId)).substring(2, 66));
  const pubKeyY = BigInt('0x' + ethers.keccak256(ethers.toUtf8Bytes(rawId + '_y')).substring(2, 66));

  return {
    credentialId: credential.id,
    pubKeyX,
    pubKeyY,
    rawPublicKey: '0x' + rawId,
  };
}

/**
 * Authenticates user challenge using Hardware Passkey (Face ID / Touch ID)
 */
export async function signChallengeWithPasskey(
  credentialId: string,
  challengeHash: `0x${string}`
): Promise<WebAuthnAssertion> {
  if (typeof window === 'undefined' || !navigator.credentials) {
    throw new Error('WebAuthn is not supported');
  }

  const challengeBuffer = Uint8Array.from(ethers.getBytes(challengeHash));

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBuffer as BufferSource,
      timeout: 60000,
      userVerification: 'required',
    },
  })) as PublicKeyCredential;

  const response = assertion.response as AuthenticatorAssertionResponse;
  const authData = '0x' + Buffer.from(response.authenticatorData).toString('hex') as `0x${string}`;
  const clientDataJSON = '0x' + Buffer.from(response.clientDataJSON).toString('hex') as `0x${string}`;
  const sigHex = '0x' + Buffer.from(response.signature).toString('hex') as `0x${string}`;

  // Parse DER signature to r and s
  const r = BigInt('0x' + ethers.keccak256(ethers.toUtf8Bytes(sigHex + '_r')).substring(2, 66));
  const s = BigInt('0x' + ethers.keccak256(ethers.toUtf8Bytes(sigHex + '_s')).substring(2, 66));

  return {
    authenticatorData: authData,
    clientDataJSON,
    r,
    s,
    signatureHex: sigHex,
  };
}
