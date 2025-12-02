<script setup lang="ts">
import { WebCutContext, WebCutColors } from '../../types';
import { useWebCutContext } from '../../hooks';
import { useDarkMode } from '../../views/dark-mode/hooks';
import {
    NConfigProvider,
    darkTheme,
    NMessageProvider,
    NLoadingBarProvider,
    NModalProvider,
    NDialogProvider,
    NElement,
    NNotificationProvider,
    zhCN,
    dateZhCN,
    zhTW,
    dateZhTW,
    GlobalThemeOverrides,
} from 'naive-ui';
import { computed, provide as provideRoot } from 'vue';
import { assignNotEmpty } from '../../libs/object';

interface WebCutProviderProps {
    data?: Partial<WebCutContext>;
    colors?: Partial<WebCutColors>;
}

const props = defineProps<WebCutProviderProps>();
const colors = computed<WebCutColors>(() => assignNotEmpty({
  baseColor: '#222222',
  baseColorDark: '#1a1a1a',
  primaryColor: '#00b4a2',
  primaryColorHover: '#01a595',
  primaryColorPressed: '#009d8d',
  primaryColorSuppl: '#009586',

  textColor: '#000000',
  textColorHover: '#01a595',
  textColorDark: '#ffffff',
  textColorDarkHover: '#eeeeee',

  backgroundColor: 'transparent',
  backgroundColorDark: '#222222',
  greyColor: '#ccc',
  greyColorDark: '#444',
  greyDeepColor: '#ddd',
  greyDeepColorDark: '#222',
  railBgColor: '#f5f5f5',
  railBgColorDark: '#1f1f1f',
  railHoverBgColor: 'rgba(126, 151, 144, 0.2)',
  railHoverBgColorDark: 'rgba(114, 251, 210, 0.2)',
  lineColor: '#eee',
  lineColorDark: '#000',
  thumbColor: '#eee',
  thumbColorDark: '#444',
  managerTopBarColor: '#f0f0f0',
  managerTopBarColorDark: '#222',
}, props.colors || {}));

provideRoot('WEBCUT_COLORS', colors);

if (props.data) {
    const { provide } = useWebCutContext(props.data);
    provide();
}

const isDarkMode = useDarkMode();
const darkOverrides = computed<GlobalThemeOverrides>(() => ({
    common: {
        primaryColor: colors.value.primaryColor,
        primaryColorHover: colors.value.primaryColorHover,
        primaryColorPressed: colors.value.primaryColorPressed,
        primaryColorSuppl: colors.value.primaryColorSuppl,
    },
    Switch: {
        railColorActive: colors.value.primaryColor,
    },
    Message: {
        iconColorSuccess: colors.value.primaryColor,
    },
    Select: {
        peers: {
            InternalSelection: {
                textColor: colors.value.textColorDark,
                textColorHover: colors.value.textColorDarkHover,
            },
        },
    },
    Badge: {
        color: colors.value.primaryColorSuppl,
    },
}));
const lightOverrides = computed<GlobalThemeOverrides>(() => ({
    common: {
        primaryColor: colors.value.primaryColor,
        primaryColorHover: colors.value.primaryColorHover,
        primaryColorPressed: colors.value.primaryColorPressed,
        primaryColorSuppl: colors.value.primaryColorSuppl,
    },
    Switch: {
        railColorActive: colors.value.primaryColor,
    },
    Message: {
        iconColorSuccess: colors.value.primaryColor,
    },
    Select: {
        peers: {
            InternalSelection: {
                textColor: colors.value.textColor,
                // @ts-ignore
                textColorHover: colors.value.textColorHover,
            },
        },
    },
    Badge: {
        color: colors.value.primaryColorSuppl,
    },
}));
const theme = computed(() => isDarkMode.value ? darkTheme : undefined);
const overrides = computed(() => isDarkMode.value ? darkOverrides.value : lightOverrides.value);

const lang = computed(() => props.data?.language || navigator.language);
const lngPkg = computed(() => {
    if (['zh-HK', 'zh-TW'].includes(lang.value)) {
        return zhTW;
    }
    if (lang.value.indexOf('zh-') === 0) {
        return zhCN;
    }
});
const dateLngPkg = computed(() => {
    if (['zh-HK', 'zh-TW'].includes(lang.value)) {
        return dateZhTW;
    }
    if (lang.value.indexOf('zh-') === 0) {
        return dateZhCN;
    }
});
</script>

<template>
    <div class="webcut-root" :style="{
        '--background-color': isDarkMode ? colors.backgroundColorDark : colors.backgroundColor,
    }">
        <n-config-provider :theme="theme" :theme-overrides="overrides" :locale="lngPkg" :date-locale="dateLngPkg">
            <n-loading-bar-provider>
                <n-modal-provider>
                    <n-dialog-provider>
                        <n-message-provider>
                            <n-element>
                                <n-notification-provider placement="bottom-right">
                                    <div class="webcut-container" :style="{
                                        '--webcut-grey-color': isDarkMode ? colors.greyDeepColorDark : colors.greyColor,
                                        '--webcut-grey-deep-color': isDarkMode ? colors.greyDeepColorDark : colors.greyDeepColor,
                                        '--webcut-rail-bg-color': isDarkMode ? colors.railBgColorDark : colors.railBgColor,
                                        '--webcut-rail-hover-bg-color': isDarkMode ? colors.railHoverBgColorDark : colors.railHoverBgColor,
                                        '--webcut-line-color': isDarkMode ? colors.lineColorDark : colors.lineColor,
                                        '--webcut-thumb-color': isDarkMode ? colors.thumbColorDark : colors.thumbColor,
                                        '--webcut-manager-top-bar-color': isDarkMode ? colors.managerTopBarColorDark : colors.managerTopBarColor,
                                        '--small-form-font-size': '10px',
                                        '--small-form-font-size-tiny': '8px',
                                    }">
                                        <slot></slot>
                                    </div>
                                </n-notification-provider>
                            </n-element>
                        </n-message-provider>
                    </n-dialog-provider>
                </n-modal-provider>
            </n-loading-bar-provider>
        </n-config-provider>
    </div>
</template>

<style scoped>
.webcut-root {
    flex: 1;
    height: 100%;
    width: 100%;
    background-color: var(--background-color);
}

.webcut-container,
.webcut-root :deep(.n-config-provider),
.webcut-root :deep(.n-element) {
    display: contents;
}

.webcut-container {
    color: var(--text-color-base);
}
.webcut-root :deep(.sprite-rect .ctrl-key-rotate) {
    cursor: url(../../img/rotate.svg) 20 20, crosshair !important;
}

/** override naiveui */

.webcut-root :deep(.n-form) {
  width: 100%;
}
.webcut-root :deep(.n-form .audio-player-wrapper) {
  justify-content: flex-start !important;
}
.webcut-root :deep(.n-form-item .n-input-number) {
  width: 100%;
}
.webcut-root :deep(.n-form-item .n-slider) {
  padding: 0 2px;
}
.webcut-root :deep(.n-form-item .n-form-item-feedback) {
  font-size: .8em;
  margin-bottom: 16px;
}
.webcut-root :deep(.n-form-item .n-input-group) {
  align-items: center;
}
.webcut-root :deep(.n-form-item .n-slider + .n-input-number) {
  width: 260px;
  margin-left: 16px !important;
}
.webcut-root :deep(.n-form-item.n-form-item--left-labelled .n-form-item-label) {
  word-break: break-all;
  white-space: wrap;
  max-width: 140px;
  align-items: center;
}
.webcut-root :deep(.n-form-item--flex-column .n-form-item-blank) {
  flex-direction: column !important;
  align-items: flex-start;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--flex-start .n-form-item-blank) {
  align-items: flex-start;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--flex-column.n-form-item--flex-start .n-form-item-blank) {
  justify-content: flex-start;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--between-space .n-form-item-blank) {
  justify-content: space-between;
}
.webcut-root :deep(.n-form-item--flex-column.n-form-item--flex-end .n-form-item-blank) {
  align-items: flex-end;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--flex-column.n-form-item--flex-end .n-input-group) {
  justify-content: flex-end;
}
.webcut-root :deep(.n-form-item--flex-end .n-form-item-blank) {
  justify-content: flex-end;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--flex-row .n-form-item-blank) {
  gap: 4px;
}
.webcut-root :deep(.n-form-item--flex-row .n-form-item-blank > .n-input-number) {
  flex: 1;
}
.webcut-root :deep(.n-form-item-message) {
  font-size: .8em;
  opacity: .8;
}
.webcut-root :deep(.n-form-item .n-input__input) {
  min-width: 60px;
  flex-grow: 1;
}
.webcut-root :deep(.n-form-item-row) {
  display: flex;
}
.webcut-root :deep(.n-form-item--inline) {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--inline > :first-child) {
  margin-right: auto;
}
.webcut-root :deep(.n-form-item--inline-between-space) {
  justify-content: space-between;
}
.webcut-root :deep(.n-form-item-actions--top-right) {
  position: absolute;
  right: 0;
  bottom: 100%;
  margin-bottom: 8px;
  display: flex;
  gap: 12px;
  align-items: center;
}
.webcut-root :deep(.n-form > .n-button + .n-button) {
  margin-left: 8px;
}
.webcut-root :deep(.n-form-gap > .n-button + .n-button) {
  margin-left: 0;
}
.webcut-root :deep(.n-form-item + .n-divider) {
    margin-top: 0;
}
.webcut-root :deep(.n-form-item--small-size),
.webcut-root :deep(.n-form-item--small-size .n-form-item-label__text) {
  font-size: var(--small-form-font-size) !important;
  --n-label-font-size: var(--small-form-font-size) !important;
}
.webcut-root :deep(.n-form-item--small-size .n-input-group-label) {
    font-size: var(--small-form-font-size) !important;
}
.webcut-root :deep(.n-form-item--small-size .n-button) {
    font-size: var(--small-form-font-size) !important;
}
.webcut-root :deep(.n-form-item--small-size .n-form-item-feedback) {
  font-size: var(--small-form-font-size-tiny);
}
.webcut-root :deep(.n-color-picker-trigger__value) {
    opacity: 0;
}
.webcut-root :deep(.n-form-item--small-size .n-input__textarea-el) {
    font-size: var(--small-form-font-size);
}
</style>