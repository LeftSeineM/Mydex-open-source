{{flutter_js}}
{{flutter_build_config}}
// The lightweight account/home entry never needs the Flutter payload.
if (!sessionStorage.getItem('mydex.connection')) {
  location.replace('/connect/');
} else _flutter.loader.load({onEntrypointLoaded: async (initializer) => {
  const app = await initializer.initializeEngine();
  await app.runApp();
  document.getElementById('loading')?.remove();
}}).catch(() => {
  document.getElementById('loading-message').textContent = '加载未完成，请检查网络后刷新。';
});
