// Phone photos are often 4-8 MB: shrink to at most 1800 px on the long side as a JPEG,
// which keeps handwriting readable at a few hundred KB.
export async function shrinkPhoto(file, maxSide = 1800) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob || file;
  } catch {
    return file;  // a format the browser can't draw (e.g. HEIC): send it as it is
  }
}

export const fileSize = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

// A photo as "data:image/jpeg;base64,...", to send inside a form's JSON.
export const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("Couldn't read that photo."));
  reader.readAsDataURL(blob);
});
