const puppeteer = require('puppeteer');
const fs = require('fs');
const FTPClient = require('ftp');
require('dotenv').config();

//Autoscroll to load all pictures on DR
async function autoScroll(page){
    await page.evaluate(async () => {
        await new Promise((resolve, reject) => {
            var totalHeight = 0;
            var distance = 100;
            var timer = setInterval(() => {
                var scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if(totalHeight >= scrollHeight - window.innerHeight){
                    clearInterval(timer);
                    resolve();
                }
            }, 30);
        });
    });
};

function UploadFTP() {
    let ftp_client = new FTPClient();
    let ftpConfig = {
        host: process.env.IP_ADDRESS,
        port: 21,
        user: process.env.USER,
        password: process.env.PASSWORD,
    }

    // Create a connection to ftp server.
    ftp_client.connect(ftpConfig);
    ftp_client.on('ready', function() {
        ftp_client.put("./news.json", "news.json", function(err) {
            if (err) throw err;
            ftp_client.end();
        });
    }); 
};

async function WebScrape() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    console.log("Browser loaded");
    await page.goto('https://dr.dk/nyheder');
    console.log("Page loaded");
    console.log("Start scroll to bottom");
    await autoScroll(page);
    console.log("Scroll to bottom ended");

    const articleSelector = '.hydra-latest-news-page__short-news-item.dre-variables'; // CSS selector for article elements
    const articleElements = await page.$$(articleSelector);

    const maxArticles = 50; // Maximum number of articles to scrape
    const articlesData = [];
    for (let i = 0; i < Math.min(maxArticles, articleElements.length); i++) {
	    console.log(`Processing news article ${i}`);

        const articleElement = articleElements[i];
        const article = {};        
        
        article.id = i;

        const headlineElement = await articleElement.$('.dre-title-text');
        if (headlineElement) {
            const headline = await headlineElement.evaluate(el => el.textContent.trim());
            article.headline = headline;
            console.log("headline", headline)
        }
        
        const labelXPath = './/*[contains(@class, "dre-label-text__text")]/span[2]'; // XPath to target the second span within the label div
        const labelElement = await articleElement.$x(labelXPath);
        if (labelElement && labelElement.length > 0) {
            const labelText = labelElement.length > 0 ? await labelElement[0].evaluate(el => el.textContent.trim()) : 'N/A';
            article.label = labelText;
            //console.log("label", labelText)
        }
        
        const paragraphsElement = await articleElement.$('[itemprop=articleBody]');
        const paragraphs = [];
        const summaryElement = await articleElement.$('.hydra-latest-news-page-short-news-card__summary');
        if (paragraphsElement) {
            const childDivs = await paragraphsElement.$$('.dre-speech');
            for (const childDiv of childDivs) {

                const paragraph = await childDiv.$('p');
                if (paragraph) {
                    const paragraphText = await paragraph.evaluate(el => el.textContent.trim());
                    paragraphs.push(paragraphText);
                }
            }

            article.paragraphs = paragraphs;
        } else {
            // Get summary
            const summaryText = await page.evaluate(el => el.textContent.trim(), summaryElement);

            // Summary can sometimes be empty
            if (summaryText.length > 0) paragraphs.push(summaryText);

            // Fallback when no paragraphs or summary
            paragraphs.push("Besøg https://dr.dk for at læse mere");

            article.paragraphs = paragraphs;
        }

        // Extract media information if available
        const mediaElement = await articleElement.$('img, video');
        if (mediaElement) {
            const mediaType = await mediaElement.evaluate(el => el.tagName.toLowerCase());
            let mediaSource;

            if (mediaType === 'video') {
                mediaSource = await mediaElement.evaluate(el => el.poster);
            } else {
                mediaSource = await mediaElement.evaluate(el => el.src);
            }

            article.media = { type: mediaType, source: mediaSource };
        }


        articlesData.push(article);
        console.log('==================');
    }

    fs.writeFile(
        './news.json',
        JSON.stringify({ articles: articlesData }), 
        (err) => err && console.error(err)
    );

    await browser.close();
    await UploadFTP();
};

WebScrape();