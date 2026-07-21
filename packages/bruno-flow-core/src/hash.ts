import sha256 from 'crypto-js/sha256';

export const sha256Hex = (value: string): string => sha256(value).toString();
