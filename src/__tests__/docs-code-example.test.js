let {Extent, Graph} = require('../index');

// tag::login_enable_extent[]
class LoginExtent extends Extent {
// end::login_enable_extent[]

    // tag::login_enable_init[]
    constructor(graph) {
        super(graph);

        this.email = this.state("");
        this.password = this.state("");

        // tag::login_enable_behavior[]
        this.behavior()
            .demands(this.email, this.password)
            .runs(() => {
                const email = this.email.value;
                const password = this.password.value;
                const hasPassword = password.length > 0;
                const loginEnabled = this.validEmailAddress(email) && hasPassword;
                this.sideEffect(() => {
                    this.enableLoginButton(loginEnabled);
                });
            });
        // end::login_enable_behavior[]
    }

    constructorComplete(graph) {

        this.loggingIn = this.state(false);

        // tag::login_complete_email[]
        this.emailValid = this.state(false);
        this.behavior()
            .supplies(this.emailValid)
            .demands(this.email)
            .runs(() => {
                const email = this.email.value;
                const emailValid = this.validEmailAddress(email);
                this.emailValid.update(emailValid);
            });
        // end::login_complete_email[]

        this.passwordValid = this.state(false);
        this.behavior()
            .supplies(this.passwordValid)
            .demands(this.password)
            .runs(() => {
                const password = this.password.value;
                const passwordValid = password.length > 0;
                this.passwordValid.update(passwordValid);
            });

        // tag::login_complete_enable[]
        this.loginEnabled = this.state(false);
        this.behavior()
            .supplies(this.loginEnabled)
            .demands(this.emailValid, this.passwordValid, this.loggingIn)
            .runs(() => {
                const enabled = this.emailValid.value && this.passwordValid.value && !this.loggingIn.value;
                this.loginEnabled.update(enabled);
                this.sideEffect(() => {
                    this.enableLoginButton(this.loginEnabled.value);
                });
            });
        // end::login_complete_enable[]

        // tag::login_complete_login[]
        this.loginClick = this.moment();
        this.returnKey = this.moment();
        this.loginComplete = this.moment();
        this.behavior()
            .supplies(this.loggingIn)
            .demands(this.loginClick, this.returnKey, this.loginComplete)
            .runs(() => {
                if ((this.loginClick.justUpdated || this.returnKey.justUpdated) &&
                    this.loginEnabled.traceValue) {
                    // Start login
                    this.loggingIn.update(true);
                } else if (this.loginComplete.justUpdated &&
                    !this.loginComplete.value &&
                    this.loggingIn.value) {
                    // Login failed
                    this.loggingIn.update(false);
                }

                if (this.loggingIn.justUpdatedTo(true)) {
                    this.sideEffect(() => {
                        this.doLogin(this.email.value, this.password.value, (success) => {
                            this.action(() => {
                                this.loginComplete.update(success);
                            });
                        });
                    });
                }
            });
        // end::login_complete_login[]

    }

    constructorCompleteAlt(graph) {
        // Dont delete; its used in the documentation
        // this has an example of requireSync
        this.behavior()
            .supplies(this.loggingIn)
            .demands(this.loginClick, this.returnKey, this.loginComplete)
            .runs(() => {
                if ((this.loginClick.justUpdated || this.returnKey.justUpdated) &&
                    this.loginEnabled.traced.value) {
                    // Start login
                    this.loggingIn.update(true, true);
                } else if (this.loginComplete.justUpdated &&
                    !this.loginComplete.value &&
                    this.loggingIn.value) {
                    // Login failed
                    this.loggingIn.update(false, true);
                }

                if (this.loggingIn.justUpdatedTo(true)) {
                    // tag::login_complete_loginalt[]
                    this.sideEffect(() => {
                        this.doLogin(this.email.value, this.password.value, (success) => {
                            this.actionAsync('login call returned', () => {
                                this.loginComplete.update(success);
                            });
                        });
                    });
                    // end::login_complete_loginalt[]
                }
            });
    }

    constructorShort(graph) {

        // tag::login_intro_short1[]
        this.behavior()
            .supplies(this.loginEnabled)
            .demands(this.email, this.password)
            .runs(() => {
                const emailValid = this.validEmailAddress(this.email.value);
                const passwordValid = this.password.value.length > 0;
                const enabled = emailValid && passwordValid;
                this.loginEnabled.update(enabled);
            });
        // end::login_intro_short1[]


        // tag::login_intro_short2[]
        this.behavior()
            .supplies(this.loggingIn)
            .demands(this.loginClick)
            .runs(() => {
                if (this.loginClick.justUpdated && !this.loggingIn.value) {
                    this.loggingIn.update(true);
                }
            });

        this.behavior()
            .supplies(this.loginEnabled)
            .demands(this.email, this.password, this.loggingIn)
            .runs(() => {
                const emailValid = this.validEmailAddress(this.email.value);
                const passwordValid = this.password.value.length > 0;
                const enabled = emailValid && passwordValid & !this.loggingIn.value;
                this.loginEnabled.update(enabled);
            })
        // end::login_intro_short2[]

        // tag::login_intro_action[]
        this.loginButton.onClick = () => {
            this.action(() => {
                this.loginClick.update();
            });
        };
        // end::login_intro_action[]

        // tag::login_intro_sideeffect[]
        this.behavior()
            .supplies(this.loginEnabled)
            .demands(this.email, this.password, this.loggingIn)
            .runs(() => {
                const emailValid = this.validEmailAddress(this.email.value);
                const passwordValid = this.password.value.length > 0;
                const enabled = emailValid && passwordValid & !this.loggingIn.value;
                this.loginEnabled.update(enabled);

                this.sideEffect(() => {
                    this.loginButton.enabled = this.loginEnabled.value;
                });
            })
        // end::login_intro_sideeffect[]

    }

    constructorCompleteShort(graph) {

        // tag::login_complete_short[]
        this.email = this.state("");
        this.password = this.state("");
        this.loggingIn = this.state("");

        this.loginEnabled = this.state(this);
        this.behavior()
            .supplies(this.loginEnabled)
            .demands(this.email, this.password, this.loggingIn)
            .runs(() => {
                const emailValid = this.validEmailAddress(this.email.value);
                const passwordValid = this.password.value.length > 0;
                const enabled = emailValid && passwordValid && !this.loggingIn.value;
                this.loginEnabled.update(enabled);
                this.sideEffect(() => {
                    this.enableLoginButton(this.loginEnabled.value);
                });
            });

        this.loginClick = this.moment();
        this.loginComplete = this.moment();
        this.behavior()
            .supplies(this.loggingIn)
            .demands(this.loginClick, this.loginComplete)
            .runs(() => {
                if (this.loginClick.justUpdated &&
                    this.loginEnabled.traceValue) {
                    // Start login
                    this.loggingIn.update(true);
                } else if (this.loginComplete.justUpdated &&
                    !this.loginComplete.value &&
                    this.loggingIn.value) {
                    // Login failed
                    this.loggingIn.update(false);
                }

                if (this.loggingIn.justUpdatedTo(true)) {
                    this.sideEffect(() => {
                        this.doLogin(this.email.value, this.password.value, (success) => {
                            this.actionAsync(() => {
                                this.loginComplete.update(success);
                            });
                        });
                    });
                }
            });
        // end::login_complete_short[]
    }

    validEmailAddress(email) {
        return email.length > 0 && email.includes('@');
    }

    doLogin(email, password, complete) {
        // login api calls
    };

    enableLoginButton(enabled) {
        // side effect to set the enabled state of the login button
    }

    // tag::login_sequence_compare[]
    emailChangedSincePassword() {
        return this.email.event.sequence > this.password.event.sequence;
    }
    // end::login_sequence_compare[]

    // tag::login_timestamp[]
    loginCompletedWhen() {
        return this.loginComplete.event.timestamp;
    }
    // end::login_timestamp[]

}

class LoginPage {

    constructor() {
        // tag::login_enable_setup[]
        this.graph = new Graph();
        this.loginExtent = new LoginExtent(this.graph);
        this.graph.action(() => {
            this.loginExtent.addToGraph();
        });
        // end::login_enable_setup[]
    }

    // tag::login_enable_actions[]
    didUpdateEmailField(contents) {
        this.graph.action(() => {
            this.loginExtent.email.update(contents);
        });
    }

    didUpdatePasswordField(contents) {
        this.graph.action(() => {
            this.loginExtent.password.update(contents);
        });
    }
    // end::login_enable_actions[]

    // tag::login_complete_click[]
    loginButtonClicked() {
        this.graph.action(() => {
            this.loginExtent.loginClick.update();
        });
    }
    // end::login_complete_click[]


}

describe("Docs: Code Example", () => {
   test("try code example", () => {
       let g = new Graph();
       let e1 = new LoginExtent(g);

      expect(true).toBeTruthy();
   });
});