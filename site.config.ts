import siteConfig from "./src/lib/config";

const config = siteConfig({
	title: "brewing",
	prologue: "code is cheap\nshow me the prompt",
	author: {
		name: "Your Name",
		email: "hi@your.mail",
		link: "https://your.website"
	},
	description: "A modern Astro theme focused on content creation.",
	copyright: {
		type: "CC BY-NC-ND 4.0",
		year: "2025"
	},
	timezone: "UTC",
	i18n: {
		locales: ["en", "zh-cn"],
		defaultLocale: "en"
	},
	pagination: {
		note: 15,
		jotting: 24
	},
	heatmap: {
		unit: "month",
		years: 2
	},
	feed: {
		section: "*",
		limit: 20
	},
	latest: "*"
});

export const monolocale = Number(config.i18n.locales.length) === 1;

export default config;
