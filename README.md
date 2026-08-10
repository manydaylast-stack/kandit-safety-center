# KANDIT SAFETY CENTER — Public Beta

Firebase project configured: `testkanditv1`

## 1) Firebase Authentication
Enable:
- Authentication → Sign-in method → Anonymous
- Authentication → Sign-in method → Email/Password

Create one admin Email/Password account.

## 2) Firestore
Create Cloud Firestore Database.
Paste the contents of `firestore.rules` into Firestore → Rules and Publish.

## 3) Give the admin account access
After signing in once with the admin Email/Password account, copy the user's Firebase Auth UID.
In Firestore create:

Collection: `admins`
Document ID: `<ADMIN_UID>`
Fields:
- `email`: `<ADMIN_EMAIL>`
- `role`: `admin`

Do not allow public users to create documents in `admins` (the supplied rules prevent this).

## 4) Deploy
Upload this folder to Netlify as a static site. The app uses Firebase's browser modules directly, so no npm build is required.

## 5) Important
This is a Public Beta / prototype for school emergency communication. It is not a replacement for the school's official emergency procedures, phone calls, alarms, or local emergency services. Test it with the school before real deployment.
