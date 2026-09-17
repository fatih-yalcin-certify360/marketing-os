import { useState, type ReactNode } from 'react';
import { Icon } from '@c360/ui';
import { assetImageUrl } from '../api/campaign-queries.js';

/**
 * A rendered variant, with what you actually do with it on hover.
 *
 * The picture used to be a link to itself and nothing else, so getting a file
 * out meant opening it in a tab and using the browser's own save (2026-09-16).
 *
 * Two different things sit behind the overlay, and the wording keeps them
 * apart because confusing them wastes a colleague's time:
 *
 *  - **Downloaden** gives the *file*, on the channel's own dimensions. That is
 *    what goes into a post.
 *  - **Delen** sends a *link to this piece in Marketing OS*, which only someone
 *    with access to this label can open. It is for "look at this before I
 *    approve it", not for handing the image to someone outside.
 *
 * Nothing is sent by pressing a share button: Teams and Outlook open with the
 * message prepared, and the person sends it.
 */
export function AssetImage(props: {
  labelId: string;
  imageAssetId: string;
  altText: string;
  /** Shown under the picture: which variant, which layout, which size. */
  captionNl: string;
  /** For the download filename and the shared message. */
  titleNl: string;
  /** Where this piece lives in the app, for the shared link. */
  appPath: string;
  widthPx: number;
  heightPx: number;
}): ReactNode {
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = assetImageUrl(props.labelId, props.imageAssetId);
  const shareUrl = `${window.location.origin}${props.appPath}`;
  const shareText = `${props.titleNl} — beeld ter beoordeling in Certify360 Marketing OS`;

  return (
    <figure className="os-asset">
      <div className="os-asset__frame">
        <img
          className="os-asset__img"
          src={url}
          alt={props.altText}
          loading="lazy"
          width={props.widthPx}
          height={props.heightPx}
        />

        <div className="os-asset__overlay">
          <a
            className="os-asset__action os-asset__action--primary"
            href={url}
            download={`${slug(props.titleNl)}-${String(props.widthPx)}x${String(props.heightPx)}.png`}
            title="Het beeldbestand opslaan, op de maat van dit kanaal"
          >
            <Icon name="download" size={15} />
            Downloaden
          </a>

          <a
            className="os-asset__action"
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Op ware grootte bekijken, voor de beeldcontrole"
          >
            <Icon name="search" size={15} />
            Groot bekijken
          </a>

          <button
            type="button"
            className="os-asset__action"
            aria-expanded={shareOpen}
            title="Een link naar dit stuk sturen aan een collega met toegang tot dit label"
            onClick={() => {
              setShareOpen((open) => !open);
            }}
          >
            <Icon name="share" size={15} />
            Delen
          </button>

        </div>
      </div>

      {shareOpen && (
        <div className="os-asset__share">
          <p className="os-asset__sharenote">
            Dit deelt een <strong>link naar dit stuk</strong>, niet het bestand. Alleen een collega
            met toegang tot dit label kan hem openen; gebruik Downloaden voor het beeld zelf.
          </p>
          <a
            className="os-asset__sharelink"
            href={`https://teams.microsoft.com/share?href=${encodeURIComponent(shareUrl)}&msgText=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noreferrer"
          >
            Teams
          </a>
          <a
            className="os-asset__sharelink"
            href={`mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`}
          >
            Outlook / e-mail
          </a>
          <button
            type="button"
            className="os-asset__sharelink"
            onClick={() => {
              void navigator.clipboard
                .writeText(shareUrl)
                .then(() => {
                  setCopied(true);
                })
                .catch(() => {
                  // Clipboard access can be refused; say so rather than leaving
                  // the button looking like it worked.
                  setCopied(false);
                });
            }}
          >
            {copied ? 'Link gekopieerd' : 'Link kopiëren'}
          </button>
        </div>
      )}
      <figcaption className="os-asset__caption">{props.captionNl}</figcaption>
    </figure>
  );
}

/** A filename a person can find back, from the piece's own title. */
function slug(title: string): string {
  const cleaned = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return cleaned.length === 0 ? 'beeld' : cleaned;
}
