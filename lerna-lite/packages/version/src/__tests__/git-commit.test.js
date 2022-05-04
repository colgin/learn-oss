"use strict";

jest.mock("temp-write");
jest.mock("@lerna-lite/core");

const { EOL } = require("os");
const tempWrite = require("temp-write");
const childProcess = require("@lerna-lite/core");
const { gitCommit } = require("../lib/git-commit");

describe("git commit", () => {
  childProcess.exec.mockResolvedValue();
  tempWrite.sync.mockReturnValue("temp-file-path");

  test("--message", async () => {
    const opts = { cwd: "message" };
    await gitCommit("subject", {}, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "-m", "subject"], opts, false);
  });

  test("--message <multiline>", async () => {
    const message = `subject${EOL}${EOL}body`;
    const opts = { cwd: "multi-line" };
    await gitCommit(message, {}, opts);
    expect(tempWrite.sync).toHaveBeenLastCalledWith(message, "lerna-commit.txt");
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "-F", "temp-file-path"], opts, false);
  });

  test("--amend", async () => {
    const opts = { cwd: "no-edit" };
    await gitCommit("whoops", { amend: true }, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "--amend", "--no-edit"], opts, false);
  });

  test("--no-commit-hooks", async () => {
    const opts = { cwd: "no-verify" };
    await gitCommit("yolo", { commitHooks: false }, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "--no-verify", "-m", "yolo"], opts, false);
  });

  test("--sign-git-commit", async () => {
    const opts = { cwd: "signed" };
    await gitCommit("nice", { signGitCommit: true }, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "--gpg-sign", "-m", "nice"], opts, false);
  });

  test("--signoff-git-commit", async () => {
    const opts = { cwd: "signed-off" };
    await gitCommit("nice", { signoffGitCommit: true }, opts);
    expect(childProcess.exec).toHaveBeenLastCalledWith("git", ["commit", "--signoff", "-m", "nice"], opts, false);
  });
});
