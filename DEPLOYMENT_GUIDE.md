# UNLOSS: Free Cloud Deployment & Multi-Device Testing Guide

This guide provides a step-by-step walkthrough for deploying the UNLOSS Parcel Verification Platform on 100% free cloud tiers, allowing you to test end-to-end delivery workflows with persistent PostgreSQL data across multiple devices (phones, tablets, and laptops).

---

## Architecture Overview

```
                      +-----------------------------------+
                      |         End Users / Devices       |
                      |  (Phones, Tablets, Laptops)      |
                      +-----------------+-----------------+
                                        |
                 +----------------------+----------------------+
                 |                                             |
                 v                                             v
+---------------------------------+           +---------------------------------+
|       Frontend Web App          |           |        Public QR Scans          |
|  Hosted on: Vercel / Cloudflare |           |   (/delivery/:token, /customer) |
|   (Vite + React 18 SPA)         |           |   GPS Location Captured         |
+----------------+----------------+           +----------------+----------------+
                 |                                             |
                 +----------------------+----------------------+
                                        |  REST API / SSE (Cookies / JWT)
                                        v
                      +-----------------------------------+
                      |          Backend API              |
                      |   Hosted on: Render / Railway     |
                      |   (Node.js + Express + Prisma)    |
                      +-----------------+-----------------+
                                        |  Database Connection Pooling
                                        v
                      +-----------------------------------+
                      |      PostgreSQL Database          |
                      |   Hosted on: Supabase / Neon      |
                      |   (Free Managed PostgreSQL)       |
                      +-----------------------------------+
```

---

## 1. Database Setup: Supabase or Neon (Free)

### Recommended: Supabase (https://supabase.com)
1. Sign up for free at [supabase.com](https://supabase.com) using GitHub or Google.
2. Click **New Project**:
   - Name: `unloss-prod`
   - Database Password: generate a strong password (save it).
   - Region: Select the closest region (e.g., `ap-south-1` for Mumbai).
3. Once initialized, navigate to **Project Settings** -> **Database**.
4. Copy the **Connection URI** (Connection pooling mode or direct):
   ```
   postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
   ```
5. In your local terminal, apply the database schema:
   ```bash
   cd apps/api
   npx prisma db push
   ```

---

## 2. Backend Deployment: Render (Free Web Service)

### Recommended: Render (https://render.com)
1. Sign up for free at [render.com](https://render.com) using GitHub.
2. Push your project to a GitHub repository:
   ```bash
   git add .
   git commit -m "UNLOSS: Production MVP with multi-role auth, GPS scan, and clean QR print"
   git push origin main
   ```
3. In Render Dashboard, click **New +** -> **Web Service**.
4. Connect your GitHub repository.
5. Configure the service:
   - **Name**: `unloss-api`
   - **Root Directory**: `apps/api`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `node dist/server.js`
   - **Instance Type**: `Free`
6. Under **Environment Variables**, add:
   ```env
   NODE_ENV=production
   PORT=10000
   API_PORT=10000
   APP_ORIGIN=https://unloss-web.vercel.app
   DATABASE_URL=your_supabase_postgres_connection_string
   SESSION_SECRET=generate_any_64_char_random_string
   DEMO_MODE=true
   QR_TOKEN_TTL_DAYS=90
   ```
7. Click **Create Web Service**. Once deployed, Render will provide your public backend URL (e.g. `https://unloss-api.onrender.com`).

---

## 3. Frontend Deployment: Vercel (Free)

### Recommended: Vercel (https://vercel.com)
1. Sign up for free at [vercel.com](https://vercel.com) with GitHub.
2. Click **Add New** -> **Project**.
3. Import your UNLOSS repository.
4. Configure Project Settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: Click edit and select `apps/web`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Under **Environment Variables**, add:
   ```env
   VITE_API_ORIGIN=https://unloss-api.onrender.com
   ```
6. Click **Deploy**. Vercel will deploy your site to `https://unloss-web.vercel.app`.

---

## 4. Google Authentication Setup (Optional for Custom Client ID)

1. Open [Google Cloud Console](https://console.cloud.google.com).
2. Create a new project: `UNLOSS Parcel Verification`.
3. Go to **APIs & Services** -> **OAuth consent screen**:
   - User Type: **External**
   - App Name: `UNLOSS`
   - Authorized Domains: `vercel.app`, `onrender.com`
4. Go to **Credentials** -> **Create Credentials** -> **OAuth Client ID**:
   - Application Type: **Web Application**
   - Authorized Javascript Origins:
     - `https://unloss-web.vercel.app`
     - `http://127.0.0.1:5173`
   - Authorized Redirect URIs:
     - `https://unloss-web.vercel.app/login`
5. Copy your **Client ID** and paste it into your frontend config.
*(Note: UNLOSS also includes a one-click simulated Google authentication provider so you can test Google logins immediately without waiting for Google Cloud approvals).*

---

## 5. End-to-End Multi-Device Testing Checklist

### Testing Across Devices:
1. **Laptop / Desktop (Seller)**:
   - Open your deployed URL: `https://unloss-web.vercel.app/login`.
   - Register as **Seller** or sign in with Google / credentials.
   - Navigate to `/orders/new` and generate a Dual-QR order.
   - Click **Print Clean QR Sheet** or toggle **Print Preview Mode**:
     - *Verified: Prints ONLY the high-contrast QR codes and their clear DELIVERY / CUSTOMER labels. Zero clutter, zero addresses, zero extra text.*

2. **Smartphone A (Courier / Delivery Guy)**:
   - Scan the **DELIVERY QR code** using the smartphone camera.
   - Browser opens `/delivery/[token]`.
   - The device prompts for GPS location permission.
   - Once permitted, the badge shows: `📍 GPS Captured: [lat, lng] (±acc m)`.
   - Location is transmitted and saved to PostgreSQL `LocationEvidence`.

3. **Smartphone B (Customer / Recipient)**:
   - Scan the **CUSTOMER QR code**.
   - Tap **Request verification code** (Phone OTP).
   - Enter the 6-digit code.
   - Select **Accept Parcel** or **Request Redelivery** with structured reasons.

4. **Seller Real-Time Verification**:
   - Return to the laptop Order Details page.
   - See the updated status and the **📍 Physical GPS Scan Evidence** card.
   - Click **View on Google Maps** to verify that the courier physically scanned the parcel at the customer's doorstep!
