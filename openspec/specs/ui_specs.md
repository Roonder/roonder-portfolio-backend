# Software Design Document (SDD) - Frontend (React.js + Vite)

## 1. Architectural Overview

The user interface will be a highly interactive Single Page Application (SPA), focused on performance and modern aesthetics (Bento Layout).

- **Bundler/Environment:** Vite.js + React.js.
- **Language:** TypeScript.
- **Styling:** TailwindCSS (Utility-first) + Shadcn UI (Accessible components without heavy dependencies).
- **Animations:** framer-motion (Motion) for page transitions, layout animations (Bento grid shift), and scroll reveals.
- **anime.js:** for specific micro-interactions, complex timelines, or particle effects (3D/SVG).
- **Remote State Management:** SWR (Stale-While-Revalidate) for agile data fetching and caching.
- **Forms:** React Hook Form integrated with @hookform/resolvers/joi or native validators for optimal UX.
- **Environment Variables:** Validation with Joi on the client side (using a simple validation wrapper on app load).

## 2. Route and View Structure

### 2.1. Public: Landing Page (/)

Modular Single Scroll design using a Bento Grid layout.

- **Hero Section:** Personal introduction, title, and calls to action (CTA). Staggered entry animations (Framer Motion).
- **Value Proposition:** Bento cards highlighting skills and services.
- **Latest Projects:** Shows the 3-4 most recent projects (SWR fetching from /projects?limit=4). Clickable cards.
- **Reviews Section:** A carousel or list of approved testimonials. Includes a button to open a "Leave a Review" modal (React Hook Form).
- **Contact:** Integrated form connected to the Resend endpoint. Handles loading, success, and error states with immediate visual feedback.

### 2.2. Public: Projects (/projects)

- Expanded grid view displaying all paginated projects.
- Filters by tags implemented client-side or requested via SWR.

### 2.3. Private: Stealth Authentication (/stealth-login or secret URL)

- An unlisted route (not in the sitemap or navigation menu).
- Clean form: Email and Password.
- Upon successful authentication, stores the JWT (either in HttpOnly cookies if configured on the backend, or in memory/localStorage) and redirects to /admin.

### 2.4. Private: Admin Dashboard (/admin/\*)

- Routes wrapped in a Route Guard / React Router Provider verifying token presence.
- **Admin Layout:** Simple sidebar menu to navigate between domains.
- **Admin Projects:** Table (Shadcn Table) with projects CRUD. Button to open creation modal/page.
- **Admin Reviews:** Moderation table. Quick action buttons to Approve/Reject (PATCH /admin/reviews/:id/approve).
- **Admin Contacts:** Inbox. Lists messages sent from the Landing Page with read status indicators and confirmed Resend integration.

## 3. Development Patterns and Methodologies

- **Simplified Atomic Design:** Base UI components in /components/ui (Shadcn), domain-specific components in /components/domain (e.g., ProjectCard, ReviewForm). Shall be joined with Screaming Architecture, for specific domains' identification.
- **Custom Hooks:** Isolate SWR logic. E.g., useProjects(), useContacts(), useAuth().
- **Error Handling:** Global Axios/Fetch interceptors coupled with Toast components (Shadcn) to elegantly notify the user of network failures.
