# Requirements Document

## Introduction

This document defines the requirements for an Email Notification system for the ecommerce platform. The system will send transactional emails to customers and administrators using Nodemailer with Gmail SMTP. Covered email types include welcome emails on registration, password reset links, order confirmations, order status updates (processing, shipped, delivered, cancelled), and payment receipts. The system integrates with existing auth, order, and payment modules without breaking current behavior.

## Glossary

- **Email_Service**: The backend service responsible for composing and dispatching all transactional emails via Gmail SMTP using Nodemailer.
- **Transporter**: The Nodemailer SMTP transport instance configured with Gmail credentials.
- **Email_Template**: An HTML/text template used to render a specific email type with dynamic data.
- **Order**: A customer purchase record with status, items, totals, and shipping address as defined in the order model.
- **Customer**: A registered user of the ecommerce platform with a valid email address.
- **Admin**: A platform administrator who may receive operational alert emails.
- **Reset_Token**: A cryptographically secure one-time token used to authorize a password reset action.
- **Order_Status**: One of `pending`, `processing`, `shipped`, `delivered`, or `cancelled`.

---

## Requirements

### Requirement 1: Email Service Infrastructure

**User Story:** As a developer, I want a centralized email service module, so that all transactional emails are sent consistently and reliably through a single, configurable interface.

#### Acceptance Criteria

1. THE Email_Service SHALL initialize a Nodemailer Transporter using Gmail SMTP with credentials loaded from environment variables.
2. WHEN the Email_Service is initialized, THE Email_Service SHALL verify the SMTP connection and log the result.
3. IF the SMTP connection verification fails, THEN THE Email_Service SHALL log the error and continue without crashing the application.
4. THE Email_Service SHALL expose a `sendEmail` method that accepts recipient address, subject, HTML body, and optional plain-text body.
5. WHEN `sendEmail` is called, THE Email_Service SHALL deliver the email within 30 seconds or throw a timeout error.
6. IF `sendEmail` encounters a delivery error, THEN THE Email_Service SHALL log the error with recipient and subject context and re-throw the error to the caller.
7. THE Email_Service SHALL be implemented as a singleton so that only one Transporter instance exists per application lifecycle.

---

### Requirement 2: HTML Email Templates

**User Story:** As a customer, I want to receive well-formatted, branded emails, so that communications from the platform are clear and professional.

#### Acceptance Criteria

1. THE Email_Service SHALL provide an HTML Email_Template for each supported email type: welcome, password reset, order confirmation, order status update, and payment receipt.
2. WHEN rendering an Email_Template, THE Email_Service SHALL substitute all dynamic placeholders (e.g., customer name, order ID, total amount) with the provided data values.
3. IF a required placeholder value is missing when rendering a template, THEN THE Email_Service SHALL substitute a safe fallback string rather than exposing a raw placeholder token.
4. THE Email_Service SHALL include a plain-text fallback body alongside every HTML email.
5. WHEN an Email_Template is rendered, THE Email_Service SHALL include the platform name and a footer with an unsubscribe notice in every outgoing email.

---

### Requirement 3: Welcome Email

**User Story:** As a new customer, I want to receive a welcome email after registering, so that I feel acknowledged and know my account was created successfully.

#### Acceptance Criteria

1. WHEN a Customer successfully registers, THE Email_Service SHALL send a welcome email to the Customer's registered email address.
2. THE welcome email SHALL include the Customer's email address and a greeting message.
3. THE welcome email SHALL include a link to the platform's homepage or shop page.
4. IF the welcome email fails to send, THEN THE Email_Service SHALL log the failure and allow the registration response to succeed without blocking the user.

---

### Requirement 4: Password Reset Email

**User Story:** As a customer who has forgotten their password, I want to receive a password reset email with a secure link, so that I can regain access to my account.

#### Acceptance Criteria

1. WHEN a Customer requests a password reset, THE Email_Service SHALL send a password reset email containing the Reset_Token link to the Customer's email address.
2. THE password reset email SHALL include a reset URL constructed from the frontend base URL and the Reset_Token.
3. THE password reset email SHALL state that the Reset_Token expires in 1 hour.
4. IF the password reset email fails to send, THEN THE Email_Service SHALL log the failure without revealing whether the email address is registered.
5. THE password reset email SHALL include a notice that the Customer should ignore the email if they did not request a reset.

---

### Requirement 5: Order Confirmation Email

**User Story:** As a customer who has placed an order, I want to receive an order confirmation email, so that I have a record of my purchase details.

#### Acceptance Criteria

1. WHEN an Order is successfully placed, THE Email_Service SHALL send an order confirmation email to the Customer who placed the Order.
2. THE order confirmation email SHALL include the Order ID, a list of ordered items with names, quantities, and unit prices, the total amount, and the shipping address.
3. THE order confirmation email SHALL include the Order's creation date formatted in a human-readable format.
4. IF the order confirmation email fails to send, THEN THE Email_Service SHALL log the failure and allow the order placement response to succeed without blocking the user.

---

### Requirement 6: Order Status Update Email

**User Story:** As a customer, I want to receive an email whenever my order status changes, so that I am kept informed about my order's progress.

#### Acceptance Criteria

1. WHEN an Order's status transitions to `processing`, `shipped`, `delivered`, or `cancelled`, THE Email_Service SHALL send an order status update email to the Customer.
2. THE order status update email SHALL include the Order ID, the new Order_Status, and a human-readable description of what the status means.
3. WHEN an Order's status transitions to `shipped`, THE order status update email SHALL include an estimated delivery notice.
4. WHEN an Order's status transitions to `cancelled`, THE order status update email SHALL include a message encouraging the Customer to contact support if the cancellation was unexpected.
5. IF the order status update email fails to send, THEN THE Email_Service SHALL log the failure and allow the status update response to succeed without blocking the admin action.

---

### Requirement 7: Payment Receipt Email

**User Story:** As a customer who has completed a payment, I want to receive a payment receipt email, so that I have confirmation of the transaction for my records.

#### Acceptance Criteria

1. WHEN a payment is successfully captured via Stripe, THE Email_Service SHALL send a payment receipt email to the Customer.
2. THE payment receipt email SHALL include the Order ID, the amount charged, the currency, and the Stripe payment intent ID.
3. THE payment receipt email SHALL include the payment date formatted in a human-readable format.
4. IF the payment receipt email fails to send, THEN THE Email_Service SHALL log the failure and allow the payment confirmation response to succeed without blocking the user.

---

### Requirement 8: Email Configuration and Security

**User Story:** As a developer, I want email credentials and configuration to be managed through environment variables, so that secrets are never hardcoded and the system is easy to configure across environments.

#### Acceptance Criteria

1. THE Email_Service SHALL read Gmail SMTP credentials (`EMAIL_USER`, `EMAIL_PASS`) exclusively from environment variables.
2. THE Email_Service SHALL read the frontend base URL (`FRONTEND_URL`) from an environment variable for constructing links in emails.
3. IF required environment variables are missing at startup, THEN THE Email_Service SHALL log a descriptive warning and disable email sending gracefully rather than crashing.
4. THE Email_Service SHALL never log or expose raw credential values in any log output.
