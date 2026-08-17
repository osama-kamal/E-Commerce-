# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at build time, so they must be present here, not at runtime.
# Without a valid publishable key the checkout refuses card payment rather than
# offering a bypass (see src/utils/checkoutMode.ts).
ARG VITE_STRIPE_PUBLISHABLE_KEY=""
ARG VITE_API_URL=""
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_API_URL=$VITE_API_URL

# NOTE: there is deliberately no VITE_STORE_ID.
# The site used to be bound to a single store at build time, which made the
# platform's own domain serve one hardcoded tenant. The tenant is now resolved
# at runtime from the hostname (see client/src/contexts/SiteContext.tsx), so an
# image built here serves the platform on the platform's domain and the right
# storefront on each tenant domain — one image, any number of stores.

RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
