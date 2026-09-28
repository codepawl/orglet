import { translate } from '../shared/i18n';
import { en } from '../shared/locales/en';

/** The terminal currently speaks English; new copy shares the desktop's Vietnamese source keys. */
export function t(source: string, ...parameters: unknown[]): string {
  return translate(en, source, parameters);
}
