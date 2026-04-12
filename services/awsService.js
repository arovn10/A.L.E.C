/**
 * A.L.E.C. AWS Service
 *
 * Manages AWS infrastructure: EC2, S3, Route53, CloudFront, SSH access.
 * Uses AWS CLI for most operations — no SDK needed.
 *
 * Setup:
 *   Run `aws configure` to set up credentials (or add to .env):
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION
 *
 * SSH into servers: uses SSH key in AWS_SSH_KEY_PATH env var.
 * Target server: AWS_WEBSITE_HOST (IP or hostname for campusrentalsllc.com)
 */

const { execFile } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

const AWS_REGION       = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
const AWS_SSH_KEY      = process.env.AWS_SSH_KEY_PATH || path.join(os.homedir(), '.ssh', 'id_rsa');
const AWS_WEBSITE_HOST = process.env.AWS_WEBSITE_HOST || null; // e.g. 'ec2-xx-xx-xx-xx.compute.amazonaws.com'
const AWS_WEBSITE_USER = process.env.AWS_WEBSITE_USER || 'ec2-user';
const AWS_CLI          = process.env.AWS_CLI_PATH || '/usr/local/bin/aws';

// ── AWS CLI wrapper ────────────────────────────────────────────────
function aws(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AWS_DEFAULT_REGION: AWS_REGION };
    execFile('aws', [...args, '--output', 'json'], { timeout: 30000, env, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else {
        try { resolve(JSON.parse(stdout.trim())); } catch { resolve(stdout.trim()); }
      }
    });
  });
}

// ── SSH helper ─────────────────────────────────────────────────────
function sshRun(command, host = AWS_WEBSITE_HOST, user = AWS_WEBSITE_USER) {
  if (!host) return Promise.reject(new Error('AWS_WEBSITE_HOST not configured in .env'));
  return new Promise((resolve, reject) => {
    const args = [
      '-i', AWS_SSH_KEY,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=15',
      `${user}@${host}`,
      command,
    ];
    execFile('ssh', args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve({ output: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ── EC2 ────────────────────────────────────────────────────────────

/**
 * List EC2 instances with status.
 */
async function listInstances(filters = []) {
  const args = ['ec2', 'describe-instances'];
  if (filters.length > 0) {
    args.push('--filters', ...filters.map(f => `Name=${f.name},Values=${f.values.join(',')}`));
  }
  const data = await aws(args);
  const instances = [];
  for (const reservation of (data.Reservations || [])) {
    for (const inst of (reservation.Instances || [])) {
      instances.push({
        id:         inst.InstanceId,
        type:       inst.InstanceType,
        state:      inst.State?.Name,
        publicIP:   inst.PublicIpAddress,
        publicDNS:  inst.PublicDnsName,
        privateIP:  inst.PrivateIpAddress,
        name:       inst.Tags?.find(t => t.Key === 'Name')?.Value || inst.InstanceId,
        launchTime: inst.LaunchTime,
      });
    }
  }
  return instances;
}

/**
 * Get instance status (health checks).
 */
async function getInstanceStatus(instanceId) {
  const data = await aws(['ec2', 'describe-instance-status', '--instance-ids', instanceId]);
  return data.InstanceStatuses?.[0] || { InstanceId: instanceId, status: 'not-found' };
}

/**
 * Start an EC2 instance.
 */
async function startInstance(instanceId) {
  return aws(['ec2', 'start-instances', '--instance-ids', instanceId]);
}

/**
 * Stop an EC2 instance.
 */
async function stopInstance(instanceId) {
  return aws(['ec2', 'stop-instances', '--instance-ids', instanceId]);
}

/**
 * Reboot an EC2 instance.
 */
async function rebootInstance(instanceId) {
  return aws(['ec2', 'reboot-instances', '--instance-ids', instanceId]);
}

// ── SSH: Website Management ────────────────────────────────────────

/**
 * Check if the website is running (nginx/apache/pm2 status).
 */
async function checkWebsiteStatus() {
  if (!AWS_WEBSITE_HOST) return { available: false, reason: 'AWS_WEBSITE_HOST not configured' };

  try {
    // Try HTTP first
    const httpCheck = await fetch(`http://${AWS_WEBSITE_HOST}`, {
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    return { online: true, httpStatus: httpCheck.status, host: AWS_WEBSITE_HOST };
  } catch (err) {
    // HTTP failed — try SSH to check server status
    try {
      const sshResult = await sshRun('sudo systemctl status nginx 2>/dev/null || sudo pm2 status 2>/dev/null || echo "No web server found"');
      return { online: false, httpError: err.message, serverStatus: sshResult.output.slice(0, 500) };
    } catch (sshErr) {
      return { online: false, httpError: err.message, sshError: sshErr.message };
    }
  }
}

/**
 * Restart the web server on the remote host.
 */
async function restartWebServer(serverType = 'nginx') {
  const cmd = `sudo systemctl restart ${serverType} && echo "✅ ${serverType} restarted"`;
  return sshRun(cmd);
}

/**
 * Pull latest code and restart (for git-deployed sites).
 */
async function deployLatest(repoPath = '~/app', restartCmd = 'pm2 restart all') {
  const cmd = `cd ${repoPath} && git pull && ${restartCmd} && echo "✅ Deploy complete"`;
  return sshRun(cmd);
}

/**
 * Get server logs (nginx, apache, or app logs).
 */
async function getServerLogs(logFile = '/var/log/nginx/error.log', lines = 50) {
  return sshRun(`sudo tail -${lines} ${logFile} 2>/dev/null || echo "Log file not found: ${logFile}"`);
}

/**
 * Get server resource usage (CPU, memory, disk).
 */
async function getServerMetrics() {
  const cmd = `echo "=CPU=" && top -bn1 | grep "Cpu(s)" | awk '{print $2}' && echo "=MEM=" && free -h | grep Mem && echo "=DISK=" && df -h / | tail -1 && echo "=UPTIME=" && uptime`;
  return sshRun(cmd);
}

/**
 * Run an arbitrary SSH command on the website server.
 */
async function sshCommand(command) {
  return sshRun(command);
}

// ── S3 ────────────────────────────────────────────────────────────

/**
 * List S3 buckets.
 */
async function listBuckets() {
  const data = await aws(['s3api', 'list-buckets']);
  return data.Buckets || [];
}

/**
 * List objects in an S3 bucket.
 */
async function listS3Objects(bucket, prefix = '', limit = 50) {
  const data = await aws(['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', prefix, '--max-items', String(limit)]);
  return data.Contents || [];
}

/**
 * Upload a file to S3.
 */
async function uploadToS3(localPath, bucket, key) {
  return aws(['s3', 'cp', localPath, `s3://${bucket}/${key}`]);
}

// ── CloudFront ─────────────────────────────────────────────────────

/**
 * Create a CloudFront cache invalidation (clear CDN cache).
 */
async function invalidateCDN(distributionId, paths = ['/*']) {
  return aws(['cloudfront', 'create-invalidation',
    '--distribution-id', distributionId,
    '--paths', ...paths,
  ]);
}

// ── Route53 ────────────────────────────────────────────────────────

/**
 * Get DNS records for a hosted zone.
 */
async function getDNSRecords(hostedZoneId) {
  const data = await aws(['route53', 'list-resource-record-sets', '--hosted-zone-id', hostedZoneId]);
  return data.ResourceRecordSets || [];
}

// ── Status ────────────────────────────────────────────────────────
async function status() {
  try {
    const data = await aws(['sts', 'get-caller-identity']);
    const website = await checkWebsiteStatus();
    return {
      configured: true,
      account: data.Account,
      arn: data.Arn,
      region: AWS_REGION,
      websiteHost: AWS_WEBSITE_HOST,
      website,
    };
  } catch (err) {
    return {
      configured: false,
      hint: 'Run: aws configure (or add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY to .env)',
      error: err.message,
    };
  }
}

module.exports = {
  listInstances, getInstanceStatus, startInstance, stopInstance, rebootInstance,
  checkWebsiteStatus, restartWebServer, deployLatest, getServerLogs, getServerMetrics, sshCommand,
  listBuckets, listS3Objects, uploadToS3,
  invalidateCDN, getDNSRecords,
  status,
};
