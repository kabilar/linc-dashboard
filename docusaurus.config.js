import {themes as prismThemes} from 'prism-react-renderer';

const PRODUCTION_URL = 'https://dashboard.lincbrain.org';

// To build a preview hosted elsewhere, set SITE_URL and BASE_URL, e.g.
//   SITE_URL=https://kabilar.github.io BASE_URL=/linc-dashboard/ npm run build
const url = process.env.SITE_URL || PRODUCTION_URL;
const baseUrl = process.env.BASE_URL || '/';
const isProduction = url === PRODUCTION_URL;

// The site is rebuilt after every data refresh and code change, so the time
// of the build is when it was last updated.
const builtAt = new Date();
// e.g. "Nov 25, 2026"
const builtOn = builtAt.toLocaleDateString('en-US', {dateStyle: 'medium', timeZone: 'UTC'});

const config = {
  title: 'LINC Dashboard',
  staticDirectories: ['static'],
  tagline: 'A summary of all LINC-related data. It is intended for the LINC project investigators. Data is indexed daily.',
  favicon: 'img/linc.logo.color+white.notext+square.png',

  url,
  baseUrl,
  organizationName: 'lincbrain',
  projectName: 'linc-dashboard',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        theme: {
          customCss: './src/css/custom.css',
        },
        docs: false,
        // Analytics only for the production site, not for previews
        gtag: isProduction
          ? {
              trackingID: 'G-9SBR1QJDN3',
              anonymizeIP: true,
            }
          : undefined,
      },
    ],
  ],

  themeConfig:
    ({
      announcementBar: isProduction
        ? undefined
        : {
            id: 'preview',
            content: `This is a preview. The live dashboard is at <a href="${PRODUCTION_URL}">dashboard.lincbrain.org</a>.`,
            isCloseable: false,
          },
      navbar: {
        logo: {
          alt: 'Logo',
          src: 'img/linc.logo.color+black.alpha.notext.png',
        },
        items: [
          // Highlighted on the home page only, rather than on every page under it
          {to: '/', label: 'Overview', position: 'right', activeBaseRegex: `^${baseUrl}$`},
          {to: '/datasets', label: 'Datasets', position: 'right'},
          {to: '/files', label: 'Files', position: 'right'},
          {to: 'https://gallery.lincbrain.org', label: 'LINC Gallery ↗', position: 'right'},
          {to: 'https://connects.mgh.harvard.edu/', label: 'Project homepage ↗', position: 'right'},
        ],
      },
      footer: {
        style: 'light',
        links: [
          {
            label: 'GitHub',
            href: 'https://github.com/lincbrain/linc-dashboard',
          },
        ],
        copyright: `Last updated <time datetime="${builtAt.toISOString()}">${builtOn}</time>`,
      },
      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        // Follow the visitor's system setting until they choose a mode
        respectPrefersColorScheme: true,
      },
      prism: {
        theme: prismThemes.github,
      },
    }),
};

export default config;
