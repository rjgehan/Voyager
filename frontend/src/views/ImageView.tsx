// The `image` view: a zoomable image. The image is a toggle button (click, Enter or Space)
// between fitting the pane and its actual size, which scrolls.
import { useState } from 'react';
import { api } from '../api/endpoints';
import { FileInfo } from './FileInfo';
import type { FileViewProps } from './registry';

export default function ImageView({ entry }: FileViewProps) {
  const [actual, setActual] = useState(false);
  return (
    <div className="media-view">
      <FileInfo entry={entry} />
      <div className={`image-stage${actual ? ' is-actual' : ''}`}>
        <button
          type="button"
          className="image-toggle"
          aria-label="Actual size"
          aria-pressed={actual}
          onClick={() => setActual(!actual)}
          title={actual ? 'Click to fit' : 'Click for actual size'}
        >
          <img src={api.rawUrl(entry)} alt={entry.name} />
        </button>
      </div>
    </div>
  );
}
