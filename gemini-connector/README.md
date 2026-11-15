# Gemini PDF Reader: setup walkthrough

This sets up a small, free program on Cloudflare that holds your Gemini key and turns
PDF pages into markdown. You then add it to Claude as a **connector**, so your artifacts
(Hobbs Proposal Desk, CDE Review, Plan revision compare and others) can use it.

You don't need to install anything. Everything happens in your web browser.
It takes about 20 minutes. Menu names on these sites change now and then,
so if a button is named slightly differently, look for the closest match.

**Never paste your Gemini key or connector password into a Claude chat.** They only go
into Cloudflare and Claude's connector settings.

---

## Step 1: Get a Gemini API key (5 min)

1. Go to **aistudio.google.com** and sign in with your Google account.
2. Click **Get API key**, then **Create API key**. Accept the defaults.
3. Copy the key (it starts with `AIza...`) into a note you can find again in a few minutes.

**About privacy:** on Google's free tier, Google may use what you send to improve its
products, and people may review it. For client bids, CDE files and submittals, turn on
billing for the key (in AI Studio, look for **Set up billing** next to the key). That moves
you to the paid tier, where Google doesn't use your data that way. Flash models cost very
little, usually cents for a large document. You can test with non-sensitive PDFs on the free tier first.

## Step 2: Create a free Cloudflare account (3 min)

1. Go to **dash.cloudflare.com** and sign up. The free plan is enough.
2. Confirm your email if it asks.

## Step 3: Create the program (a "Worker") (5 min)

1. In the Cloudflare dashboard, open **Workers & Pages** (under **Compute** in the left menu).
2. Click **Create**, then choose the **Hello World** starter.
3. Name it `gemini-pdf-reader`, then click **Deploy**.
4. Click **Edit code**.
5. Delete everything in the code window.
6. Open `worker.js` from this folder on GitHub, click the **Copy raw file** button, and paste it into the code window.
7. Click **Deploy** (top right).

## Step 4: Add your secrets (5 min)

1. Go back to your Worker's page and open **Settings**, then **Variables and Secrets**.
2. Click **Add**, set the type to **Secret**, and add:
   - Name: `GEMINI_API_KEY`. Value: the key from Step 1.
3. Click **Add** again, type **Secret**:
   - Name: `CONNECTOR_TOKEN`. Value: a long random password. Use 30 or more letters and
     numbers, no spaces or symbols. A password manager's "generate" button is ideal.
     Save it in your note as well.
4. Click **Deploy** or **Save** to apply them.
5. *(Optional)* To use a different Gemini model, add a **Text** variable `GEMINI_MODEL`, for
   example `gemini-2.5-pro` for the hardest scans. The default is `gemini-2.5-flash`.

## Step 5: Build your connector address

On the Worker's main page, find its address. It looks like:

```
https://gemini-pdf-reader.YOUR-NAME.workers.dev
```

Your connector address is that, plus `/mcp/`, plus your password from Step 4:

```
https://gemini-pdf-reader.YOUR-NAME.workers.dev/mcp/YOUR-CONNECTOR-TOKEN
```

Treat this full address like a password. Anyone who has it can use your Gemini key.

## Step 6: Add it to Claude (3 min)

1. Go to **claude.ai/customize/connectors**.
2. Choose **Add custom connector**.
3. Name: `Gemini PDF Reader`. URL: the address from Step 5. Leave any login or OAuth settings empty.
4. Click **Add**. Claude should show one tool, `convert_pages_to_markdown`.

## Step 7: Tell Claude you're done

Start a **new** Claude Code session (connectors are loaded when a session starts) and say
"the Gemini PDF Reader connector is added." Don't paste the address. Claude will then wire it into
Hobbs Proposal Desk as the pilot.

---

## How the artifacts will use it

1. You upload a PDF in the artifact as usual.
2. The page reads the PDF's own text first. That costs nothing and is exact.
3. It sends pages to Gemini in batches of up to 10, as images plus that exact text. Gemini
   uses the text as the source of truth for numbers and spelling, and the image for tables,
   layout, scans and drawings.
4. The finished markdown is saved with the artifact. From then on, every review or proposal step
   uses the markdown instead of the big PDF, which is where the token savings come from.
5. Each page is marked so you can see which pages need a human spot-check.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Not found" | The address or password in Claude's connector doesn't match `CONNECTOR_TOKEN`. Re-check both. |
| "GEMINI_API_KEY is not set" | Repeat Step 4 and make sure you deployed after adding it. |
| "Gemini refused the request: API key not valid" | Re-copy the key from AI Studio into Cloudflare. |
| "Gemini refused the request: ... quota" | You hit the free tier's daily limit. Wait a day or turn on billing. |
| "...model ... not found" | Google retired the model. Set `GEMINI_MODEL` to a current Flash model name listed in AI Studio. |
| `truncated: true` | Too much text for one call. The artifact will retry with fewer pages. |

## Turning it off

To stop it at any time, remove the connector at claude.ai/customize/connectors,
or delete the Worker in Cloudflare. You can also delete the key in AI Studio.
