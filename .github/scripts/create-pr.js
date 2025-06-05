#!/usr/bin/env node

const { Octokit } = require('@octokit/rest');
const fs = require('fs').promises;
const path = require('path');

async function createPullRequest() {
    const token = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;
    const [owner, repo] = repository.split('/');

    const octokit = new Octokit({ auth: token });

    try {
        // Get the default branch
        const { data: repoData } = await octokit.repos.get({ owner, repo });
        const defaultBranch = repoData.default_branch;

        // Get the current branch name from environment
        const headBranch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;

        // Read PR metadata from environment variables
        const title = process.env.PR_TITLE || 'Translation Update';
        const body = process.env.PR_BODY || 'Automated translation update';

        // Create the pull request
        const { data: pr } = await octokit.pulls.create({
            owner,
            repo,
            title,
            body,
            head: headBranch,
            base: defaultBranch,
            draft: false
        });

        console.log(`Pull request created: ${pr.html_url}`);
        console.log(`::set-output name=pr_url::${pr.html_url}`);
        console.log(`::set-output name=pr_number::${pr.number}`);

        // Add labels if specified
        const labels = process.env.PR_LABELS;
        if (labels) {
            await octokit.issues.addLabels({
                owner,
                repo,
                issue_number: pr.number,
                labels: labels.split(',').map(l => l.trim())
            });
        }

        // Request reviewers if specified
        const reviewers = process.env.PR_REVIEWERS;
        if (reviewers) {
            await octokit.pulls.requestReviewers({
                owner,
                repo,
                pull_number: pr.number,
                reviewers: reviewers.split(',').map(r => r.trim())
            });
        }

    } catch (error) {
        console.error('Error creating pull request:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    createPullRequest();
}

module.exports = { createPullRequest };