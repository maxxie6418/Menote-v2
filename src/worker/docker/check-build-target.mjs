if (process.env.WORKERS_CI === "1") {
  console.error("Menote is released through Docker. Disable the legacy Workers Builds trigger.");
  process.exitCode = 1;
}
