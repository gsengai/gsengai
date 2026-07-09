// SPDX-License-Identifier: Apache-2.0

/** Thrown for features that exist in the API surface but are deliberately not implemented in the MVP. */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}
