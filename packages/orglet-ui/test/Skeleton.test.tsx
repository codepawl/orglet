import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Skeleton, SkeletonGroup, SkeletonText } from '../src';

describe('Skeleton', () => {
  it('is a hidden shape sized by its props', () => {
    const { container } = render(<Skeleton shape="circle" width={24} height="2em" delay={0.2} />);
    const shape = container.firstChild as HTMLElement;
    expect(shape.getAttribute('aria-hidden')).toBe('true');
    expect(shape.className).toBe('org-skeleton org-skeleton-circle');
    expect(shape.style.width).toBe('24px');
    expect(shape.style.height).toBe('2em');
    expect(shape.style.animationDelay).toBe('0.2s');
  });

  it('is a line by default and applies the caller class last', () => {
    const { container } = render(<Skeleton className="model-row-bar" />);
    expect((container.firstChild as HTMLElement).className).toBe('org-skeleton org-skeleton-line model-row-bar');
  });
});

describe('SkeletonText', () => {
  it('draws one bar per line, the last one shorter, each starting a beat later', () => {
    const { container } = render(<SkeletonText lines={3} className="about-notes" />);
    const paragraph = container.firstChild as HTMLElement;
    expect(paragraph.className).toBe('org-skeleton-text about-notes');
    expect(paragraph.getAttribute('aria-hidden')).toBe('true');
    const bars = Array.from(paragraph.children) as HTMLElement[];
    expect(bars).toHaveLength(3);
    expect(bars.map(bar => bar.style.width)).toEqual(['', '', '55%']);
    expect(bars.map(bar => bar.style.animationDelay)).toEqual(['0s', '0.08s', '0.16s']);
  });

  it('keeps a single line full width', () => {
    const { container } = render(<SkeletonText lines={1} />);
    expect(((container.firstChild as HTMLElement).firstChild as HTMLElement).style.width).toBe('');
  });
});

describe('SkeletonGroup', () => {
  it('is one status region that says what is on its way', () => {
    render(<SkeletonGroup label="Loading the chat" className="chat-loading">
      <Skeleton shape="circle" />
      <SkeletonText lines={2} />
    </SkeletonGroup>);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('Loading the chat');
    expect(region.className).toBe('org-skeleton-group chat-loading');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<SkeletonGroup label="Loading the chat">
      <Skeleton shape="circle" />
      <SkeletonText />
    </SkeletonGroup>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
