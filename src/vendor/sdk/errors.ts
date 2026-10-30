/** Base error for all SDK-originated failures. */
export class SdkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SdkError";
  }
}

/** Invalid or incomplete SDK configuration. */
export class SdkConfigError extends SdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SdkConfigError";
  }
}

/** A configured contract address is required for this operation. */
export class MissingAddressError extends SdkConfigError {
  readonly key: string;

  constructor(key: string) {
    super(`No address configured for "${key}". Set it in the SDK address book or pass it explicitly.`);
    this.name = "MissingAddressError";
    this.key = key;
  }
}

/** A write was attempted without an account-capable wallet client. */
export class MissingAccountError extends SdkError {
  constructor() {
    super("This operation writes to the chain; construct the SDK with an account or wallet client.");
    this.name = "MissingAccountError";
  }
}
