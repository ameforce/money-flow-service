import hudson.model.User
import hudson.security.FullControlOnceLoggedInAuthorizationStrategy
import hudson.security.HudsonPrivateSecurityRealm
import jenkins.model.Jenkins

def webUser = (System.getenv("JENKINS_WEB_ADMIN_USER") ?: "jenkins").trim()
def webPassword = System.getenv("JENKINS_WEB_ADMIN_PASSWORD")
def legacyUser = (System.getenv("JENKINS_WEB_LEGACY_USER") ?: "").trim()

if (!webPassword || !webPassword.trim()) {
    throw new IllegalStateException("JENKINS_WEB_ADMIN_PASSWORD is required")
}

def jenkins = Jenkins.get()
def realm = jenkins.getSecurityRealm()
if (!(realm instanceof HudsonPrivateSecurityRealm)) {
    realm = new HudsonPrivateSecurityRealm(false)
    jenkins.setSecurityRealm(realm)
}

def existing = User.get(webUser, false)
if (existing != null) {
    existing.delete()
}

realm.createAccount(webUser, webPassword)

if (legacyUser && legacyUser != webUser) {
    def oldUser = User.get(legacyUser, false)
    if (oldUser != null) {
        oldUser.delete()
    }
}

jenkins.setAuthorizationStrategy(new FullControlOnceLoggedInAuthorizationStrategy())
jenkins.save()
