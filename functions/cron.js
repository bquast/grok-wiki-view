export default {
  async scheduled({ cron, env }) {
    await fetch('https://your-domain.com/api/popular'); // Triggers refresh
  }
};