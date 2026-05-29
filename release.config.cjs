module.exports = {
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/github",
      {
        assets: [
          {
            path: "cli/dist/release/switchboard-linux-x64.tar.gz",
            label: "Linux x64 tarball",
          },
          {
            path: "cli/dist/release/switchboard-linux-arm64.tar.gz",
            label: "Linux arm64 tarball",
          },
        ],
        failComment: false,
        successComment: false,
      },
    ],
  ],
};
