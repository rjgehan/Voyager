// Small pieces of the guest page (DESIGN §6.45) shared by the landing page and a share's view.
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { landingHref } from './page';

export function Loading() {
  return (
    <div className="view-loading guest-loading" aria-busy="true">
      <div className="skeleton-line" />
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
    </div>
  );
}

export function Problem({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <main className="guest-problem" role="alert">
      <CircleAlert size={28} aria-hidden />
      <h1>{title}</h1>
      <p>{detail}</p>
      {action}
    </main>
  );
}

export function LandingLink() {
  return (
    <a className="button" href={landingHref()}>
      See what is shared with you
    </a>
  );
}
