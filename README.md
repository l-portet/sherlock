# 🔎 Sherlock – Simple influencer insights for TikTok & IG

A simple browser extension to get influencer stats on TikTok & Instagram.

<img width="1682" height="856" alt="CleanShot 2025-10-27 at 15 50 51@2x" src="https://github.com/user-attachments/assets/48a790c2-9a6d-4a96-b817-48ed9d66a8ad" />

## Setup

I haven’t had time to create a proper extension yet, so we’ll inject the scripts using a third-party extension.

1. Install [User JavaScript and CSS](https://chromewebstore.google.com/detail/user-javascript-and-css/nbhcbdghjpllgmfilhnhkllmkecfmpld) from the Chrome Web Store.  
2. Get your API keys on RapidAPI (both have free plans):  
   - [TikTok Scraper API](https://rapidapi.com/Lundehund/api/tiktok-api23)  
   - [Instagram Scraper API](https://rapidapi.com/NikitusLLP/api/instagram-premium-api-2023)  
3. Create rules for `https://www.instagram.com/*` and `https://www.tiktok.com/@*` in the extension.  
4. Inject the JS & CSS for each rule:  
   - TikTok: [JS](./tiktok/script.js) & [CSS](./tiktok/sheet.css)  
   - Instagram: [JS](./instagram/script.js) & [CSS](./instagram/sheet.css)  

> ⚠️ Make sure to enable the JS option **“Run in an isolated environment”**, otherwise you’ll get CORS issues.

5. Add your API keys to the `RAPIDAPI_KEY` variables.  
6. You’re good to go!

## Notes

- Not affiliated with TikTok, Instagram, or RapidAPI.  
- There’s still a lot of room for improvement, I quickly vibe-coded it. Feel free to contribute!

## Contribute

Open a PR if you want to contribute.  

Ideas for improvement:
- Turn it into a real browser extension  
- Add caching and smarter data fetching  
- Detect paid partnerships via LLM analysis of post captions  
- Add lightweight CRM features  
- Improve the UI

## Contact

Found an issue or just want to say hi? Reach out on [X/Twitter](https://x.com/lukecarry_).

## License

Licensed under the [Beerware License](LICENSE.md).
