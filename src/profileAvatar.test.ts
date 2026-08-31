import { describe, expect, test } from "bun:test";
import { constrainedAvatarDimensions, DEFAULT_AVATAR_MAX_BYTES, isImageFile, readAvatarFile } from "./profileAvatar";

const read = async (file: File) => `data:${file.name}`;

describe("profile picture upload validation", () => {
  test("accepts a screenshot with a recognised extension when the picker omits MIME metadata", async () => {
    const screenshot = { name: "Screen Shot 2026-08-31.PNG", type: "", size: 1024 } as File;
    expect(isImageFile(screenshot)).toBe(true);
    expect(await readAvatarFile(screenshot, read)).toBe("data:Screen Shot 2026-08-31.PNG");
  });

  test("bounds each side by the caller's output dimension without distorting the image", () => {
    expect(constrainedAvatarDimensions(4000, 2000, 400)).toEqual({ width: 400, height: 200 });
    expect(constrainedAvatarDimensions(200, 100, 400)).toEqual({ width: 200, height: 100 });
  });

  test("refuses non-images and respects the caller's byte limit before reading", async () => {
    let reads = 0;
    const countedRead = async (file: File) => { reads += 1; return read(file); };
    await expect(readAvatarFile({ name: "notes.pdf", type: "application/pdf", size: 10 } as File, countedRead)).rejects.toThrow(/image/i);
    await expect(readAvatarFile({ name: "large.png", type: "image/png", size: 11 } as File, countedRead, { maxBytes: 10 })).rejects.toThrow(/10 byte/i);
    await expect(readAvatarFile({ name: "default-limit.png", type: "image/png", size: DEFAULT_AVATAR_MAX_BYTES + 1 } as File, countedRead)).rejects.toThrow(/upload limit/i);
    expect(reads).toBe(0);
  });
});
