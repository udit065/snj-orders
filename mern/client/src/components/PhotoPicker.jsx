import { useEffect, useRef } from "react";
import { shrinkPhoto } from "../photo.js";

// Up to `max` photos, shrunk on the phone before sending. `photos` is [{ blob, url }].
export default function PhotoPicker({ photos, onChange, max = 1, label = "Add a photo" }) {
  const input = useRef(null);
  const latest = useRef(photos);
  latest.current = photos;
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const pick = async (e) => {
    const chosen = [...e.target.files].slice(0, max - photos.length);
    e.target.value = "";
    const added = [];
    for (const f of chosen) {
      const blob = await shrinkPhoto(f);
      added.push({ blob, url: URL.createObjectURL(blob) });
    }
    onChange([...photos, ...added]);
  };
  const remove = (i) => {
    URL.revokeObjectURL(photos[i].url);
    onChange(photos.filter((_, j) => j !== i));
  };

  return (
    <div className="picker">
      <input ref={input} type="file" accept="image/*" multiple={max > 1} hidden onChange={pick} />
      {photos.map((p, i) => (
        <div key={p.url} className="picker-thumb">
          <img src={p.url} alt={`Photo ${i + 1}`} />
          <button type="button" className="picker-remove" aria-label="Remove photo" onClick={() => remove(i)}>×</button>
        </div>
      ))}
      {photos.length < max && (
        <button type="button" className="picker-add" onClick={() => input.current.click()}>
          <span aria-hidden="true">📷</span><span>{label}</span>
        </button>
      )}
    </div>
  );
}
