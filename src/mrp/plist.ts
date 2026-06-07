import bplistCreator from "bplist-creator";
import bplistParser from "bplist-parser";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createPlist = bplistCreator as unknown as (obj: any) => Buffer;
const parsePlist = bplistParser as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseBuffer(buffer: Buffer): any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlistValue = any;

export class Plist {
  static encode(obj: PlistValue): Buffer {
    return createPlist(obj);
  }

  static decode(buffer: Buffer): PlistValue {
    const result = parsePlist.parseBuffer(buffer);
    return Array.isArray(result) ? result[0] : result;
  }
}

export function plistObjectGuard(value: PlistValue): value is Record<string, PlistValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
