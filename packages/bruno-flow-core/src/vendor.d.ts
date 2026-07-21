declare module 'crypto-js/sha256' {
  interface WordArray {
    toString(): string;
  }

  const sha256: (message: string) => WordArray;
  export default sha256;
}
