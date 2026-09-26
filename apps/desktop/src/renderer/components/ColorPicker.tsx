// The picker moved into the kit (COD-274); this wrapper gives it the app's own words, so its callers did not change.
import { ColorPicker as KitColorPicker, type ColorPickerLabels, type ColorPickerProps } from '@codepawl/orglet-ui';
import { t } from '../i18n';

export { normalizeHex } from '@codepawl/orglet-ui';

function colorPickerLabels(): ColorPickerLabels {
  return {
    panel: t('Tạo màu'),
    area: t('Độ đậm và độ sáng'),
    areaValue: (saturation, brightness) => t('Độ đậm {0}%, độ sáng {1}%', [saturation, brightness]),
    hue: t('Sắc màu'),
    hex: t('Mã màu hex'),
    save: t('Lưu màu'),
    presets: t('Màu có sẵn'),
    saved: t('Màu của bạn'),
    presetColor: color => t('Màu {0}', [color]),
    savedColor: color => t('Màu của bạn {0}', [color]),
    removeColor: color => t('Xóa màu {0}', [color]),
    removeTitle: t('Xóa màu'),
    done: t('Xong'),
  };
}

export function ColorPicker(props: Omit<ColorPickerProps, 'labels'>) {
  return <KitColorPicker {...props} labels={colorPickerLabels()} />;
}
