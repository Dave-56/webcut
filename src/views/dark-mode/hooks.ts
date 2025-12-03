import { useWebCutContext } from '../../hooks';
import { onMounted, computed, watch } from 'vue';

export function useWebCutPerfersColorScheme() {
  const { id, perfersColorScheme } = useWebCutContext();

  // 初始化，第一次进来时，从localStorage中获取用户的偏好颜色方案
  onMounted(() => {
      const perfersColorSchemeCache = localStorage.getItem('prefers-color-scheme:' + id.value);
      if (perfersColorSchemeCache && perfersColorSchemeCache !== perfersColorScheme.value) {
          perfersColorScheme.value = perfersColorSchemeCache as 'light' | 'dark';
      }
  });

  // 当用户改变偏好颜色方案时，更新localStorage
  watch(perfersColorScheme, (newValue) => {
    localStorage.setItem('prefers-color-scheme:' + id.value, newValue);
  });

  // // 当浏览器改变偏好颜色方案时，更新本地
  // const media = window.matchMedia(' (prefers-color-scheme: dark)');
  // const onChange = () => {
  //   const next = media.matches ? 'dark' : 'light';
  //   if (next !== perfersColorScheme.value) {
  //     perfersColorScheme.value = next;
  //   }
  // };
  // onMounted(() => {
  //   media.addEventListener('change', onChange);
  // });
  // onUnmounted(() => {
  //   media.removeEventListener('change', onChange);
  // });

  return perfersColorScheme;
}

export function useWebCutDarkMode() {
  const perfersColorScheme = useWebCutPerfersColorScheme();
  const isDarkMode = computed({
    get: () => perfersColorScheme.value === 'dark',
    set: (v: boolean) => {
      perfersColorScheme.value = v ? 'dark' : 'light';
    }
  });
  return isDarkMode;
}
