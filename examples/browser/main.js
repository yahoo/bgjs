//
//  Copyright Yahoo 2021
//

import * as bg from "behavior-graph"

function validateEmail(email) {
    const re = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email);
}

function inputFeedback(elementId, status) {
    let element = document.getElementById(elementId);
    if (status) {
        element.className = "fa fa-check";
        element.style.color = "green";
    } else {
        element.className = "fa fa-ban";
        element.style.color = "red";
    }
}

function loginButtonEnable(enable) {
    let element = document.getElementById("login");
    element.disabled = !enable;
}

function loginToServer(email, password) {
    // login functionality goes here
}

function updateLoginStatus(status) {
    let element = document.getElementById("loginStatus");
    element.innerHTML = status;
}

class LoginExtent extends bg.Extent {
    email = new bg.State(this,null);
    password = new bg.State(this,null);
    emailValid = new bg.State(this,false);
    passwordValid = new bg.State(this,false);
    loginEnabled = new bg.State(this,false);
    loggingIn = new bg.State(this, false);
    loginClick = new bg.Moment(this);
    loginComplete = new bg.Moment(this);

    constructor(graph) {
        super(graph);

        this.makeBehavior([this.email, this.addedToGraph], [this.emailValid], (extent) => {

            let email = extent.email.value;
            let emailValid = validateEmail(email);
            extent.emailValid.update(emailValid);
            extent.sideEffect((extent) => {
                inputFeedback("emailFeedback", extent.emailValid.value);
            }, undefined, null);

        });


        this.makeBehavior([this.password, this.addedToGraph], [this.passwordValid], (extent) => {

            let password = extent.password.value ?? "";
            let passwordValid = password.length > 0;
            extent.passwordValid.update(passwordValid);
            extent.sideEffect((extent) => {
                inputFeedback("passwordFeedback", extent.passwordValid.value);
            }, undefined, "passwordFeedback");

        });


        this.makeBehavior([this.emailValid, this.passwordValid, this.loggingIn, this.addedToGraph], [this.loginEnabled], (extent) => {

            let enabled = extent.emailValid.value && extent.passwordValid.value && !extent.loggingIn.value;
            extent.loginEnabled.update(enabled)
            extent.sideEffect((extent) => {
                loginButtonEnable(extent.loginEnabled.value);
            }, undefined, "enable login button");

        });


        this.makeBehavior([this.loginClick, this.loginComplete, this.addedToGraph], [this.loggingIn], (extent) => {

            if (extent.loginClick.justUpdated && extent.loginEnabled.traceValue) {
                extent.loggingIn.update(true);
            } else if (extent.loginComplete.justUpdated && extent.loggingIn.value) {
                extent.loggingIn.update(false);
            }

            if (extent.loggingIn.justUpdatedTo(true)) {
                extent.sideEffect((extent) => {
                    loginToServer(extent.email.value, extent.password.value);
                }, undefined, "login api call");
            }

        });


        this.makeBehavior([this.loggingIn, this.loginComplete, this.addedToGraph], null, (extent) => {
            extent.sideEffect((extent) => {
                let status = "&nbsp;"
                if (extent.loggingIn.value) {
                    status = "Logging in...";
                } else if (extent.loggingIn.justUpdatedTo(false)) {
                    if (extent.loginComplete.justUpdated && extent.loginComplete.value) {
                        status = "Login Success";
                    } else if (extent.loginComplete.justUpdated && !extent.loginComplete.value) {
                        status = "Login Failed";
                    }
                }
                updateLoginStatus(status);
            }, undefined, "login status");
        });

    }
}

let graph = new bg.Graph();
let loginExtent = new LoginExtent(graph);
graph.action("startup", () => {
    loginExtent.addToGraph()
});

document.getElementById("email").addEventListener("input", (event) => {
    loginExtent.email.updateWithAction(event.target.value);
});

document.getElementById("password").addEventListener("input", (event) => {
    loginExtent.password.updateWithAction(event.target.value);
});

document.getElementById("login").addEventListener("click", (event) => {
    loginExtent.loginClick.updateWithAction()
});

document.getElementById("loginSuccess").addEventListener("click", (event) => {
    loginExtent.loginComplete.updateWithAction(true);
});

document.getElementById("loginFail").addEventListener("click", (event) => {
    loginExtent.loginComplete.updateWithAction(false);
});
