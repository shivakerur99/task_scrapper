const puppeteer = require('puppeteer');
const AWS = require('aws-sdk');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const sleep = (milliseconds) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const dynamoDB = new AWS.DynamoDB.DocumentClient();

async function scrapeData(url) {
    console.log('Scraping job empory healthcare...');
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: 'networkidle2' });
        await sleep(10000); 

        // Locate the iframe and switch context
        const iframeElement = await page.$('iframe');
        const frame = await iframeElement.contentFrame();

        const jobs = await frame.evaluate(() => {
            const jobElements = document.querySelectorAll('body > div.iCIMS_MainWrapper.iCIMS_ListingsPage > div.container-fluid.iCIMS_JobsTable > div');
            const jobData = [];

            jobElements.forEach(job => {
                const jobTitleElem = job.querySelector('div.col-xs-12.title > a > h3');
                const jobTitle = jobTitleElem ? jobTitleElem.textContent.trim() : 'NA';
                const joblinkele = job.querySelector('div.col-xs-12.title > a');
                const jobDescriptionUrl = joblinkele ? joblinkele.href : 'NA';

                jobData.push({
                    jobTitle,
                    jobDescriptionUrl,
                });
            });

            return jobData;
        });

        console.log(jobs);
        return jobs;
    } catch (error) {
        console.error('Error during scraping job listings:', error);
        return [];
    } finally {
        await browser.close();
    }
}

async function scrapeDescription(url) {
    console.log('Scraping job description from:', url);
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    try {
        await page.goto(url);
        await page.waitForSelector('iframe');

        // Locate the iframe and switch context
        const iframeElement = await page.$('iframe');
        const frame = await iframeElement.contentFrame();

        await frame.waitForSelector('p');

        const description = await frame.evaluate(() => {
            const paragraphs = Array.from(document.querySelectorAll('p'));
            return paragraphs.map(p => p.textContent.trim());
        });
        console.log(description);
        console.log('Job description scraped successfully!');
        return description;
    } catch (error) {
        console.error('Error scraping job description:', error);
        return 'NA';
    } finally {
        await browser.close();
    }
}

async function insertDataIntoDynamoDB(data) {
    console.log('Inserting data into DynamoDB...');

    for (const job of data) {
        const description = await scrapeDescription(job.jobDescriptionUrl);
        job.Description = description;
        job.jobID = uuidv4();

        const params = {
            TableName: 'jobs',
            Item: job
        };

        try {
            await dynamoDB.put(params).promise();
        } catch (error) {
            console.error('Error inserting data into DynamoDB:', error);
        }
    }

    fs.writeFileSync('scrapedJobData.json', JSON.stringify(data, null, 2));
    console.log('Data written to JSON file successfully!');
}

async function main() {
    try {
        const url = "https://non-clinical-emory.icims.com/jobs/search";
        const scrapedData = await scrapeData(url);
        await insertDataIntoDynamoDB(scrapedData);
    } catch (error) {
        console.error('Error:', error);
    }
}

main();