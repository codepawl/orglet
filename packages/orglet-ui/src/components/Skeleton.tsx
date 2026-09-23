import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../cn';
import './Skeleton.css';

/**
 * The shape of content on its way: a bar where a line of text will be, a block where a paragraph or a picture
 * will be, a circle where a face will be. It says nothing itself, which is why a group of them sits inside a
 * `SkeletonGroup` that carries the one sentence assistive technology hears.
 *
 * A skeleton is for the rare wait that cannot be hidden by fetching early; a spinner is never the answer. The
 * shimmer runs well under a second per pass so the wait reads as brisk, and stops under `prefers-reduced-motion`.
 */
export function Skeleton({ shape = 'line', width, height, delay, className, style }: {
  shape?: 'line' | 'block' | 'circle';
  /** A CSS length or a percentage; a line defaults to the full width of its box. */
  width?: string | number;
  height?: string | number;
  /** Seconds into the shimmer this one starts, so stacked lines do not pulse in lockstep. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const sizing: CSSProperties = { ...style };
  if (width !== undefined) sizing.width = width;
  if (height !== undefined) sizing.height = height;
  if (delay !== undefined) sizing.animationDelay = `${delay}s`;
  return <span aria-hidden="true" className={cn('org-skeleton', `org-skeleton-${shape}`, className)} style={sizing} />;
}

/**
 * A set of skeletons standing in for one thing: a row, a list, a page. `label` is what a screen reader is told,
 * because the shapes are hidden from it. The group is a live status region, so the sentence is announced once
 * and goes quiet when real content replaces it.
 */
export function SkeletonGroup({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <div role="status" aria-live="polite" className={cn('org-skeleton-group', className)}>
    <span className="org-skeleton-label">{label}</span>
    {children}
  </div>;
}

/** A paragraph on its way: `lines` bars, the last one shorter, each starting its shimmer a beat after the one above. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return <span className={cn('org-skeleton-text', className)} aria-hidden="true">
    {Array.from({ length: lines }, (_, index) => <Skeleton key={index} width={index === lines - 1 && lines > 1 ? '55%' : undefined} delay={index * 0.08} />)}
  </span>;
}
