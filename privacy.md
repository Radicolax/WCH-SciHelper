# Privacy Policy for WCH-SciHelper

Last updated: October 2026

WCH-SciHelper is committed to protecting your privacy. This Privacy Policy explains our data practices.

### 1. Data Collection and Usage
WCH-SciHelper does NOT collect, store, sell, or transmit any personally identifiable information (PII), browsing history, authentication credentials, or financial data.

The extension interacts strictly on the client side with the user's active browser session to:
- Read scholarly publication identifiers (such as DOI, PMID, ISSN, and journal title) from the active webpage DOM solely to query official journal classification ratings and open-access full-text download links.
- Communicate with the user's local Zotero standalone application (via http://127.0.0.1:23119/) to import citation metadata and open-access PDFs when initiated by the user.
- Store local preferences (such as display toggles and UI layout options) within the user's local browser storage (`chrome.storage.local`).

### 2. Third-Party Requests
When retrieving metadata or legal open-access full-text links, the extension communicates directly with public scholarly APIs (such as Crossref, OpenAlex, Europe PMC, and NCBI E-utilities). These queries are executed purely to provide bibliographic metadata and do not track individual users.

### 3. Data Transfer and Security
- No user data is sold or transferred to third parties.
- No user data is used for targeted advertising, credit scoring, or commercial profiling.
- All operations are performed locally within the client's browser environment.

### 4. Contact
If you have any questions regarding this Privacy Policy, please open an issue in the official GitHub repository.
