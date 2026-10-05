import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import * as kit from '../src';

type IconComponent = (props: kit.IconProps) => React.JSX.Element;

const icons = Object.entries(kit)
  .filter(([name]) => name.endsWith('Icon'))
  .map(([name, component]) => [name, component as IconComponent] as const);

function renderedSvg(Icon: IconComponent, props: kit.IconProps = {}) {
  const { container } = render(<Icon {...props} />);
  return container.querySelector('svg')!;
}

describe('icons', () => {
  it('ships the full set', () => {
    expect(icons).toHaveLength(37);
  });

  it.each(icons)('%s is an svg on the 20-unit grid', (_name, Icon) => {
    const svg = renderedSvg(Icon);
    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg.getAttribute('class')).toBe('org-icon');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
  });

  it.each(icons)('%s is hidden from assistive technology by default', (_name, Icon) => {
    const svg = renderedSvg(Icon);
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('aria-label')).toBeNull();
  });

  it.each(icons)('%s is named by its title', (_name, Icon) => {
    const svg = renderedSvg(Icon, { title: 'Label' });
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Label');
    expect(svg.getAttribute('aria-hidden')).toBeNull();
  });

  it.each(icons)('%s applies size and puts the caller class last', (_name, Icon) => {
    const svg = renderedSvg(Icon, { size: 24, className: 'mine' });
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.getAttribute('class')).toBe('org-icon mine');
  });

  it('draws with the current colour only', () => {
    for (const [, Icon] of icons) {
      const markup = renderedSvg(Icon).outerHTML;
      expect(markup).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
    }
  });

  it('passes the rest of the svg props through', () => {
    const svg = renderedSvg(kit.CheckIcon, { id: 'check', style: { color: 'red' } });
    expect(svg.id).toBe('check');
    expect(svg.style.color).toBe('red');
  });

  it('has no accessibility violations, bare or named', async () => {
    const { container } = render(<>
      {icons.map(([name, Icon]) => <Icon key={name} />)}
      {icons.map(([name, Icon]) => <Icon key={`${name}-titled`} title={name} />)}
    </>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
