ALTER TABLE feedback ADD COLUMN screenshot_provided INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback ADD COLUMN github_issue_url TEXT;
