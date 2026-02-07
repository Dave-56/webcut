<script setup lang="ts">
import { useWebCutThemeColors, useWebCutDarkMode } from '../../hooks';

const { themeColors } = useWebCutThemeColors();
const { isDarkMode } = useWebCutDarkMode();
</script>

<template>
    <div
        class="webcut-theme-box"
        :style="{
            '--webcut-background-color': isDarkMode ? themeColors.backgroundColorDark : themeColors.backgroundColor,
            '--webcut-grey-color': isDarkMode ? themeColors.greyColorDark : themeColors.greyColor,
            '--webcut-grey-deep-color': isDarkMode ? themeColors.greyDeepColorDark : themeColors.greyDeepColor,
            '--webcut-rail-bg-color': isDarkMode ? themeColors.railBgColorDark : themeColors.railBgColor,
            '--webcut-rail-hover-bg-color': isDarkMode ? themeColors.railHoverBgColorDark : themeColors.railHoverBgColor,
            '--webcut-theme-opacity-color': themeColors.primaryColor[0] === '#' ? themeColors.primaryColor.slice(0, 7) + '80' : themeColors.primaryColor,
            '--webcut-line-color': isDarkMode ? themeColors.lineColorDark : themeColors.lineColor,
            '--webcut-thumb-color': isDarkMode ? themeColors.thumbColorDark : themeColors.thumbColor,
            '--webcut-manager-top-bar-color': isDarkMode ? themeColors.managerTopBarColorDark : themeColors.managerTopBarColor,
            '--webcut-close-icon-color': isDarkMode ? themeColors.closeIconColorDark : themeColors.closeIconColor,
            '--webcut-text-primary': isDarkMode ? themeColors.textColorDark : themeColors.textColor,
            '--webcut-text-secondary': isDarkMode ? '#cccccc' : '#a3a3a3',
            '--webcut-text-muted': isDarkMode ? '#a1a1a1' : '#525252',
            '--webcut-panel-bg': isDarkMode ? themeColors.greyDeepColorDark : '#fafafa',
            '--webcut-subtle-bg': isDarkMode ? themeColors.greyColorDark : '#f5f5f5',
            '--webcut-button-bg': isDarkMode ? themeColors.greyColorDark : '#f1f1ef',
            '--webcut-border-color': isDarkMode ? themeColors.lineColorDark : '#e5e5e5',
            '--text-color-base': isDarkMode ? themeColors.textColorDark : themeColors.textColor,
            '--webcut-font-size-large': '20px',
            '--webcut-font-size-normal': '14px',
            '--webcut-font-size-small': '12px',
            '--webcut-font-size-tiny': '10px',
        }"
    >
        <slot></slot>
    </div>
</template>