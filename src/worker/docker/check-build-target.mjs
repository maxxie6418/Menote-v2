if (process.env.WORKERS_CI === "1" && process.env.WORKERS_CI_BRANCH === "main") {
  console.error("Menote main is released through Docker. Stop the legacy Workers Builds trigger for this branch.");
  process.exitCode = 1;
}
