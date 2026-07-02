#!/usr/bin/env bash
set -euo pipefail

# Register / update the money-flow-service Multi-branch Pipeline job on Jenkins.
# This assumes Jenkins has been preconfigured with:
# - credentials (JENKINS_USER / JENKINS_PASSWORD or ENM_USER / ENM_PASSWORD)
# - workflow-multibranch + git plugins installed
JENKINS_URL="${JENKINS_URL:-https://jenkins.enmsoftware.com}"
JENKINS_USER="${ENM_USER:-${JENKINS_USER:-}}"
JENKINS_PASSWORD="${ENM_PASSWORD:-${JENKINS_PASSWORD:-}}"
JENKINS_JOB_NAME="${JENKINS_JOB_NAME:-money-flow-service}"
MONEYFLOW_REPO_URL="${MONEYFLOW_REPO_URL:-https://github.com/ameforce/money-flow-service.git}"
JENKINSFILE_PATH="${JENKINSFILE_PATH:-Jenkinsfile}"
# Optional, enable periodic indexing only when needed
SCAN_SPEC="${JENKINS_MULTI_BRANCH_SCAN_SPEC:-}"

if [[ -z "$JENKINS_USER" || -z "$JENKINS_PASSWORD" ]]; then
  echo "ERROR: JENKINS_USER/JENKINS_PASSWORD must be provided (or ENM_USER/ENM_PASSWORD)." >&2
  exit 1
fi

AUTH_HEADER="Authorization: Basic $(printf '%s:%s' "$JENKINS_USER" "$JENKINS_PASSWORD" | base64)"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
cookie_path="$tmp_dir/cookies.txt"

crumb="$(curl -sSf -u "$JENKINS_USER:$JENKINS_PASSWORD" \
  -c "$cookie_path" \
  "$JENKINS_URL/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,\":\",//crumb)")"
crumb_field="${crumb%%:*}"
crumb_value="${crumb##*:}"

if [[ -z "$crumb_field" || -z "$crumb_value" ]]; then
  echo "ERROR: failed to fetch Jenkins crumb" >&2
  exit 1
fi

read -r -d '' GROOVY <<'GROOVY'
import org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject
import org.jenkinsci.plugins.workflow.multibranch.WorkflowBranchProjectFactory
import jenkins.branch.BranchSource
import jenkins.plugins.git.GitSCMSource
import jenkins.plugins.git.traits.BranchDiscoveryTrait

def jobName = (System.getenv("JENKINS_JOB_NAME") ?: "money-flow-service").trim()
def repoUrl = (System.getenv("MONEYFLOW_REPO_URL") ?: "https://github.com/ameforce/money-flow-service.git").trim()
def scriptPath = (System.getenv("JENKINSFILE_PATH") ?: "Jenkinsfile").trim()
def scanSpec = (System.getenv("JENKINS_MULTI_BRANCH_SCAN_SPEC") ?: "").trim()

def existing = Jenkins.instance.getItem(jobName)
if (existing != null) {
    existing.delete()
}

def project = Jenkins.instance.createProject(WorkflowMultiBranchProject, jobName)
def source = new GitSCMSource(repoUrl)
source.setTraits([new BranchDiscoveryTrait()] as List)

project.getSourcesList().add(new BranchSource(source))

def factory = new WorkflowBranchProjectFactory()
factory.setScriptPath(scriptPath)
project.setProjectFactory(factory)

if (scanSpec) {
    import com.cloudbees.hudson.plugins.folder.computed.PeriodicFolderTrigger
    project.getTriggers().clear()
    project.addTrigger(new PeriodicFolderTrigger(scanSpec))
}

Jenkins.instance.save()
project.save()
project.getComputation().run()
println "UPDATED=$jobName"
println "REPO=$repoUrl"
println "SCRIPT=$scriptPath"
println "SCAN_SPEC=${scanSpec ?: 'none'}"
GROOVY

curl -sSf -b "$cookie_path" -H "$AUTH_HEADER" -H "$crumb_field: $crumb_value" \
  --data-urlencode "script=$GROOVY" \
  "$JENKINS_URL/scriptText"
